"""Hindsight demo API.

An in-memory workspace that powers the frontend without a database or API keys.
Paper search calls the real arXiv API; the LLM steps (claims, contradictions,
confidence, dead ends, briefing) run as clearly labelled heuristics until live
provider execution is wired in.

    python demo_server.py          # http://127.0.0.1:8001  (API docs at /docs)
"""
import calendar
import os
import random
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
import xml.etree.ElementTree as ET
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse, RedirectResponse
from pydantic import BaseModel, Field

FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
STEP_SECONDS = float(os.getenv("DEMO_STEP_SECONDS", "1.6"))
ARXIV_API = "https://export.arxiv.org/api/query"
USER_AGENT = "hindsight-demo/0.1"
CURRENT_USER = "m_you"

ProviderId = Literal["claude", "openai", "groq", "custom"]
PROVIDER_IDS: tuple[str, ...] = ("claude", "openai", "groq", "custom")

LOCK = threading.RLock()
KEYS: dict[str, str] = {}
DB: dict[str, Any] = {
    "team": {}, "settings": {}, "members": {}, "questions": {}, "runs": {}, "beliefs": {},
    "dead_ends": {}, "papers": {}, "claims": {}, "contradictions": {}, "meetings": {},
    "tasks": [], "activity": [], "providers": {}, "routing": {},
}


def now() -> datetime:
    return datetime.now(timezone.utc)


BOOT = now()


def ago(days: float = 0, hours: float = 0, minutes: float = 0) -> datetime:
    return BOOT - timedelta(days=days, hours=hours, minutes=minutes)


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def local_date(dt: datetime) -> date:
    return dt.astimezone().date()


def add_months(d: date, months: int) -> date:
    years, month_index = divmod(d.month - 1 + months, 12)
    year, month = d.year + years, month_index + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def clip(text: str, n: int = 80) -> str:
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


# --------------------------------------------------------------------------- catalogue

STEPS: list[dict[str, Any]] = [
    {"key": "search", "task": "paper_search", "label": "Search papers", "short": "Search",
     "description": "Find candidate papers for the question."},
    {"key": "extract", "task": None, "label": "Fetch & extract", "short": "Extract",
     "description": "Fetch each paper and split it into citable passages."},
    {"key": "claims", "task": "claim_extraction", "label": "Extract claims", "short": "Claims",
     "description": "Pull the specific claims each paper makes, with exact quotes."},
    {"key": "contradictions", "task": "contradiction_detection", "label": "Find contradictions", "short": "Conflicts",
     "description": "Compare claims across papers and flag disagreements."},
    {"key": "confidence", "task": "confidence_scoring", "label": "Score confidence", "short": "Confidence",
     "description": "Weigh supporting evidence against limiting evidence."},
    {"key": "dead_ends", "task": "dead_end_proposal", "label": "Flag dead ends", "short": "Dead ends",
     "description": "Propose approaches the evidence argues against."},
    {"key": "synthesis", "task": "synthesis_briefing", "label": "Write briefing", "short": "Briefing",
     "description": "Summarise the findings and draft a belief for the team to review."},
]

TASKS: dict[str, dict[str, str]] = {
    "paper_search": {"label": "Paper search", "description": "Turn the question into search queries",
                     "reason": "Speed-critical, light reasoning"},
    "claim_extraction": {"label": "Claim extraction", "description": "Read papers and pull claims with exact quotes",
                         "reason": "Quality-critical: long context and exact quotes"},
    "contradiction_detection": {"label": "Contradiction detection", "description": "Compare claims across papers",
                                "reason": "Cross-paper reasoning"},
    "confidence_scoring": {"label": "Confidence scoring", "description": "Weigh supporting and limiting evidence",
                           "reason": "Calibrated judgement"},
    "dead_end_proposal": {"label": "Dead-end proposal", "description": "Flag approaches the evidence argues against",
                          "reason": "Careful reasoning about limitations"},
    "synthesis_briefing": {"label": "Briefing", "description": "Write the briefing and the draft belief",
                           "reason": "Long-form writing quality"},
    "stance_extraction": {"label": "Stance extraction", "description": "Attribute positions to speakers in meetings",
                          "reason": "Speaker attribution accuracy"},
    "quote_verification": {"label": "Quote verification", "description": "Check quotes match the source text",
                           "reason": "Fast, cheap string checks"},
}

PRESETS: dict[str, dict[str, tuple[str, Optional[str]]]] = {
    "quality": {
        "paper_search": ("groq", "claude"), "claim_extraction": ("claude", "openai"),
        "contradiction_detection": ("claude", "openai"), "confidence_scoring": ("claude", "openai"),
        "dead_end_proposal": ("claude", "openai"), "synthesis_briefing": ("claude", "openai"),
        "stance_extraction": ("claude", "openai"), "quote_verification": ("groq", "claude"),
    },
    "balanced": {
        "paper_search": ("groq", "openai"), "claim_extraction": ("claude", "openai"),
        "contradiction_detection": ("claude", "openai"), "confidence_scoring": ("openai", "claude"),
        "dead_end_proposal": ("openai", "claude"), "synthesis_briefing": ("claude", "openai"),
        "stance_extraction": ("openai", "claude"), "quote_verification": ("groq", "openai"),
    },
    "speed": {task: ("groq", "claude") for task in TASKS},
    "cost": {task: ("groq", "openai") for task in TASKS},
}
PRESET_REASON = {
    "balanced": "Balanced preset: top quality where it matters, cheaper elsewhere",
    "speed": "Speed preset: fastest provider first",
    "cost": "Cost preset: free tier first, cheapest fallback",
}

PROVIDER_META: dict[str, dict[str, Any]] = {
    "claude": {"name": "Anthropic Claude", "short": "Claude", "defaultModel": "claude-opus-5-5",
               "models": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1"],
               "keyPlaceholder": "sk-ant-…", "consoleUrl": "https://console.anthropic.com/settings/keys",
               "blurb": "Best at long-context reading and careful reasoning."},
    "openai": {"name": "OpenAI", "short": "OpenAI", "defaultModel": "gpt-5",
               "models": ["gpt-5", "gpt-5-mini", "gpt-4.1", "gpt-4o"],
               "keyPlaceholder": "sk-…", "consoleUrl": "https://platform.openai.com/api-keys",
               "blurb": "Strong general-purpose fallback."},
    "groq": {"name": "Groq", "short": "Groq", "defaultModel": "llama-3.3-70b-versatile",
             "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "openai/gpt-oss-120b"],
             "keyPlaceholder": "gsk_…", "consoleUrl": "https://console.groq.com/keys",
             "blurb": "Very fast inference with a free tier."},
    "custom": {"name": "OpenAI-compatible", "short": "Custom", "defaultModel": "", "models": [],
               "keyPlaceholder": "API key", "consoleUrl": None,
               "blurb": "Any OpenAI-compatible API: OpenRouter, Together, Mistral, or a local Ollama server."},
}

# USD per 1M tokens (input, output). Estimates — adjust to your contract.
PRICES: dict[str, tuple[float, float]] = {
    "claude-opus-5-5": (5.0, 25.0), "claude-sonnet-5-5": (3.0, 15.0), "claude-haiku-5-5": (1.0, 5.0),
    "claude-fable-5-1": (5.0, 25.0), "gpt-5": (1.25, 10.0), "gpt-5-mini": (0.25, 2.0), "gpt-4.1": (2.0, 8.0),
    "gpt-4o": (2.5, 10.0), "llama-3.3-70b-versatile": (0.59, 0.79), "llama-3.1-8b-instant": (0.05, 0.08),
    "openai/gpt-oss-120b": (0.15, 0.75),
}


def short_name(pid: Optional[str]) -> str:
    return PROVIDER_META[pid]["short"] if pid in PROVIDER_META else (pid or "—")


def cost_of(provider: str, model: Optional[str], tin: int, tout: int) -> float:
    if provider not in PROVIDER_IDS:
        return 0.0
    if provider == "groq" and DB["settings"].get("groqFreeTier", True):
        return 0.0
    pin, pout = PRICES.get(model or "", (0.0, 0.0))
    return round((tin * pin + tout * pout) / 1_000_000, 6)


# --------------------------------------------------------------------------- records

def log_activity(kind: str, text: str, actor: str = "agent", link: Optional[dict] = None,
                 at: Optional[datetime] = None) -> None:
    DB["activity"].append({"id": new_id("a"), "at": at or now(), "kind": kind, "actor": actor,
                           "text": text, "link": link})


def add_task(*, at: datetime, task: str, provider: str, routed_to: Optional[str], model: Optional[str],
             tin: int, tout: int, latency_ms: int, status: str, fallback_from: Optional[str],
             question_id: Optional[str], mode: str, reason: Optional[str]) -> None:
    DB["tasks"].append({
        "id": new_id("t"), "at": at, "task": task, "provider": provider, "routedTo": routed_to, "model": model,
        "inputTokens": tin, "outputTokens": tout, "costUsd": cost_of(provider, model, tin, tout),
        "latencyMs": latency_ms, "status": status, "fallbackFrom": fallback_from, "questionId": question_id,
        "mode": mode, "reason": reason,
    })


def add_paper(*, title: str, authors: list[str], year: Optional[int], summary: str, summary_kind: str,
              arxiv_id: Optional[str] = None, published: Optional[str] = None, pdf: Optional[str] = None,
              et_al: bool = False, pid: Optional[str] = None, added_by: str = "agent",
              added_at: Optional[datetime] = None, source: str = "arxiv") -> str:
    if arxiv_id:
        existing = next((p for p in DB["papers"].values() if p["arxivId"] == arxiv_id), None)
        if existing:
            return existing["id"]
    pid = pid or new_id("p")
    DB["papers"][pid] = {
        "id": pid, "arxivId": arxiv_id, "title": title, "authors": authors, "etAl": et_al, "year": year,
        "published": published, "source": source,
        "url": f"https://arxiv.org/abs/{arxiv_id}" if arxiv_id else None,
        "pdfUrl": pdf or (f"https://arxiv.org/pdf/{arxiv_id}" if arxiv_id else None),
        "summary": summary, "summaryKind": summary_kind, "addedAt": added_at or now(), "addedBy": added_by,
    }
    return pid


def make_belief(bid: str, *, statement: str, confidence: float, status: str, question_id: Optional[str],
                sources: list[str], evidence: str, created: datetime, history: list[dict],
                approved_by: Optional[str] = None, approved_at: Optional[datetime] = None) -> None:
    DB["beliefs"][bid] = {
        "id": bid, "statement": statement, "confidence": confidence, "status": status, "questionId": question_id,
        "sources": sources, "evidence": evidence, "createdAt": created,
        "updatedAt": history[-1]["at"] if history else created, "approvedBy": approved_by,
        "approvedAt": approved_at, "history": history,
    }


def make_dead_end(did: str, *, title: str, reason: str, revisit: Optional[str], status: str,
                  question_id: Optional[str], related: list[str], created: datetime,
                  decided_by: Optional[str] = None, decided_at: Optional[datetime] = None,
                  created_by: str = "agent") -> None:
    DB["dead_ends"][did] = {
        "id": did, "title": title, "reason": reason, "revisitTrigger": revisit, "status": status,
        "questionId": question_id, "relatedPapers": related, "createdAt": created, "createdBy": created_by,
        "decidedBy": decided_by, "decidedAt": decided_at,
    }


def blank_step(spec: dict) -> dict:
    return {
        "key": spec["key"], "task": spec["task"], "label": spec["label"], "short": spec["short"],
        "description": spec["description"], "status": "pending", "startedAt": None, "finishedAt": None,
        "routedTo": None, "model": None, "routeReason": None, "executor": None, "inputTokens": 0,
        "outputTokens": 0, "costUsd": 0.0, "detail": None, "fallbackFrom": None,
    }


def new_question(qid: str, text: str, context: Optional[str], created_by: str, created: datetime) -> dict:
    q = {"id": qid, "question": text, "context": context, "createdBy": created_by, "createdAt": created,
         "updatedAt": created, "lastRunAt": None, "archived": False, "runIds": []}
    DB["questions"][qid] = q
    return q


def attach_findings(run: dict, *, claims: list[tuple[str, str, str, str]], contradictions: list[tuple[int, int, str]],
                    score: float, rationale: str, synthesis: str, screened: int, belief: Optional[str],
                    dead_ends: list[str]) -> None:
    qid = run["questionId"]
    claim_ids = []
    for paper_id, text, stance, kind in claims:
        cid = new_id("c")
        DB["claims"][cid] = {"id": cid, "runId": run["id"], "questionId": qid, "paperId": paper_id,
                             "text": text, "kind": kind, "stance": stance}
        claim_ids.append(cid)
    contradiction_ids = []
    for a, b, explanation in contradictions:
        xid = new_id("x")
        DB["contradictions"][xid] = {"id": xid, "runId": run["id"], "questionId": qid, "claimA": claim_ids[a],
                                     "claimB": claim_ids[b], "explanation": explanation, "severity": "tension"}
        contradiction_ids.append(xid)
    stances = [DB["claims"][c]["stance"] for c in claim_ids]
    run["findings"] = {
        "synthesis": synthesis, "claimIds": claim_ids, "contradictionIds": contradiction_ids,
        "paperIds": list(dict.fromkeys(DB["claims"][c]["paperId"] for c in claim_ids)), "screened": screened,
        "confidence": {"score": score, "supporting": stances.count("supports"), "limiting": stances.count("limits"),
                       "neutral": stances.count("neutral"), "rationale": rationale},
        "beliefId": belief, "deadEndIds": dead_ends,
    }


# --------------------------------------------------------------------------- routing

def provider_available(pid: Optional[str]) -> bool:
    p = DB["providers"].get(pid or "")
    return bool(p and p["enabled"] and KEYS.get(pid or "") and p["status"] in ("untested", "connected"))


def route(task: str, forced: Optional[str]) -> dict:
    routing = DB["routing"]
    rule = routing["rules"][task]
    if forced and routing["allowOverride"]:
        return {"routedTo": forced, "reason": f"Forced to {short_name(forced)} by user override", "fallbackFrom": None}
    primary, fallback = rule["primary"], rule["fallback"]
    if (not provider_available(primary) and routing["autoFallback"] and fallback
            and provider_available(fallback)):
        return {"routedTo": fallback, "fallbackFrom": primary,
                "reason": f"{rule['reason']} · {short_name(primary)} not connected, fell back to {short_name(fallback)}"}
    return {"routedTo": primary, "reason": rule["reason"], "fallbackFrom": None}


def apply_preset(priority: str) -> None:
    DB["routing"]["priority"] = priority
    DB["routing"]["rules"] = {
        task: {"primary": primary, "fallback": fallback,
               "reason": TASKS[task]["reason"] if priority == "quality" else PRESET_REASON[priority]}
        for task, (primary, fallback) in PRESETS[priority].items()
    }


# --------------------------------------------------------------------------- arXiv + heuristics

STOPWORDS = set("""
a an the of and or to in on for with without by is are was were be been being can could should would will
do does did how what which who whom whose why when where we our us it its this that these those than then
vs versus into from at as about over under between their there here more most less least very much many
any some such not no yes if so just also still only per via using use used make makes work works worth help
helps cut cuts hurt hurting improve improves reduce reduces better best good new large small big impact
effect effects approach approaches method methods possible way ways whether really actually instead keep
""".split())
ATOM = {"a": "http://www.w3.org/2005/Atom"}
RESULT_CUES = re.compile(
    r"\b(we (show|find|demonstrate|observe|report)|achiev\w*|improv\w*|reduc\w*|outperform\w*|speed-?ups?|"
    r"faster|accura\w*|throughput|latency)\b|\d+(\.\d+)?\s?(x|×|%)", re.I)
NEG_CUES = re.compile(
    r"\b(however|fail\w*|degrad\w*|worse|limitations?|cannot|can't|does not|do not|no significant|unstable|"
    r"instabilit\w*|at the cost of|suffers?|struggl\w*|poorly|(accuracy|quality|performance) (loss|drop|degradation))\b",
    re.I)
OWN_CUES = re.compile(r"\b(we propose|we introduce|we present|our (method|approach|system|framework)|this paper)\b", re.I)


LATEX_SUBS = [
    (re.compile(r"\$?\\times\$?"), "×"), (re.compile(r"\$?\\sim\$?"), "~"), (re.compile(r"\$?\\approx\$?"), "≈"),
    (re.compile(r"\$?\\geq?\$?"), "≥"), (re.compile(r"\$?\\leq?\$?"), "≤"), (re.compile(r"\\%"), "%"),
    (re.compile(r"\\(?:textbf|textit|emph|texttt|mathrm|text)\{([^}]*)\}"), r"\1"),
    (re.compile(r"\$([^$]{1,40})\$"), r"\1"), (re.compile(r"[{}]"), ""),
]


def clean_latex(text: str) -> str:
    for pattern, replacement in LATEX_SUBS:
        text = pattern.sub(replacement, text)
    return " ".join(text.split())


class StepError(Exception):
    pass


def keywords(text: str) -> list[str]:
    out: list[str] = []
    for token in re.findall(r"[A-Za-z][A-Za-z0-9]*|\d+[A-Za-z]+\d*", text):
        t = token.lower()
        if t in STOPWORDS or len(t) < 2:
            continue
        if any(ch.isdigit() for ch in t) and not re.fullmatch(r"(fp|int|bf)\d+|[a-z]\d{2,3}[a-z]?", t):
            continue
        if t not in out:
            out.append(t)
    return out


def arxiv_query(params: dict, timeout: float = 15) -> list[dict]:
    url = f"{ARXIV_API}?{urllib.parse.urlencode(params)}"
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read()
    except urllib.error.HTTPError as exc:
        raise StepError(f"arXiv returned HTTP {exc.code}. Try again in a minute.") from exc
    except OSError as exc:
        reason = getattr(exc, "reason", exc)
        raise StepError(f"Couldn't reach arXiv ({reason}). Check your internet connection.") from exc
    root = ET.fromstring(payload)
    results = []
    for entry in root.findall("a:entry", ATOM):
        raw_id = (entry.findtext("a:id", "", ATOM) or "").strip()
        match = re.search(r"arxiv\.org/abs/(.+?)(v\d+)?$", raw_id)
        title = clean_latex(entry.findtext("a:title", "", ATOM) or "")
        if not match or title.lower() == "error":
            continue
        published = (entry.findtext("a:published", "", ATOM) or "").strip()
        pdf = next((link.get("href") for link in entry.findall("a:link", ATOM) if link.get("title") == "pdf"), None)
        results.append({
            "arxivId": match.group(1), "title": title,
            "authors": [" ".join((a.findtext("a:name", "", ATOM) or "").split()) for a in entry.findall("a:author", ATOM)],
            "year": int(published[:4]) if published[:4].isdigit() else None, "published": published[:10] or None,
            "summary": clean_latex(entry.findtext("a:summary", "", ATOM) or ""), "summaryKind": "abstract",
            "pdfUrl": pdf, "etAl": False,
        })
    return results


def split_sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z(\[])", text)
    return [p.strip() for p in parts if 40 <= len(p.strip()) <= 420]


def stance_of(sentence: str) -> str:
    if NEG_CUES.search(sentence) and not OWN_CUES.search(sentence):
        return "limits"
    return "supports"


def content_words(sentence: str) -> set[str]:
    return {w for w in re.findall(r"[a-z][a-z0-9\-]{3,}", sentence.lower()) if w not in STOPWORDS}


def paper_label(paper: dict) -> str:
    authors = paper.get("authors") or []
    lead = authors[0].split()[-1] if authors else "Unknown"
    suffix = " et al." if paper.get("etAl") or len(authors) > 1 else ""
    return f"{lead}{suffix} ({paper.get('year') or 'n.d.'})"


def step_search(ctx: dict, q: dict) -> tuple[str, str]:
    if ctx["canned"]:
        return f"Found {ctx['screened']} candidate papers", "sample"
    kws = keywords(q["question"]) or keywords(q["context"] or "")
    if not kws:
        raise StepError("Couldn't pick search terms from the question. Add specific technical terms.")
    queries = []
    if len(kws) >= 3:
        queries.append(" AND ".join(f"all:{k}" for k in kws[:3]))
    if len(kws) >= 2:
        queries.append(" AND ".join(f"all:{k}" for k in kws[:2]))
    queries.append(" OR ".join(f"all:{k}" for k in kws[:6]))
    results: list[dict] = []
    for attempt, query in enumerate(queries):
        if attempt:
            time.sleep(3)  # arXiv asks API clients to wait 3 seconds between requests
        results = arxiv_query({"search_query": query, "start": 0, "max_results": DB["settings"]["maxPapers"],
                               "sortBy": "relevance"})
        if len(results) >= 4:
            break
    if not results:
        raise StepError("arXiv returned no papers for this question. Try more specific technical terms.")
    ctx["candidates"], ctx["keywords"] = results, kws
    return f"arXiv search for “{' '.join(kws[:4])}” returned {len(results)} papers", "arxiv"


def step_extract(ctx: dict, q: dict) -> tuple[str, str]:
    if ctx["canned"]:
        return f"Parsed {len(ctx['papers'])} relevant papers into passages", "sample"
    total = 0
    for paper in ctx["candidates"]:
        paper["sentences"] = split_sentences(paper["summary"])
        total += len(paper["sentences"])
    return f"Split {len(ctx['candidates'])} abstracts into {total} passages (live mode parses full-text PDFs)", "local"


def step_claims(ctx: dict, q: dict) -> tuple[str, str]:
    if ctx["canned"]:
        return f"{len(ctx['claims'])} claims from {len(ctx['papers'])} papers", "sample"
    stems = [k[:5] for k in ctx["keywords"]]
    papers: list[dict] = []
    claims: list[dict] = []
    for candidate in ctx["candidates"]:
        scored = []
        for sentence in candidate["sentences"]:
            low = sentence.lower()
            hits = sum(1 for stem in stems if re.search(r"\b" + re.escape(stem), low))
            if hits:
                scored.append((hits + (1.5 if RESULT_CUES.search(sentence) else 0), sentence))
        if not scored:
            continue
        scored.sort(key=lambda item: -item[0])
        index = len(papers)
        papers.append(candidate)
        picked = [scored[0][1]]
        for score, sentence in scored[1:]:
            if score >= 2 and stance_of(sentence) != stance_of(picked[0]):
                picked.append(sentence)
                break
        claims.extend({"paper": index, "text": s, "stance": stance_of(s), "kind": "quote"} for s in picked)
        if len(claims) >= 16:
            break
    if not claims:
        raise StepError("None of the papers found make claims that match the question. Try rephrasing it.")
    ctx["papers"], ctx["claims"], ctx["screened"] = papers, claims, len(ctx["candidates"])
    return f"{len(claims)} verbatim claims from {len(papers)} of {len(ctx['candidates'])} papers", "heuristic"


def step_contradictions(ctx: dict, q: dict) -> tuple[str, str]:
    if not ctx["canned"]:
        pairs = []
        for i, a in enumerate(ctx["claims"]):
            for j, b in enumerate(ctx["claims"]):
                if a["stance"] == "supports" and b["stance"] == "limits" and a["paper"] != b["paper"]:
                    shared = sorted(content_words(a["text"]) & content_words(b["text"]))
                    if len(shared) >= 2:
                        pairs.append((len(shared), i, j, shared))
        pairs.sort(key=lambda item: -item[0])
        chosen, used = [], set()
        for _, i, j, shared in pairs:
            if (i, j) in used:
                continue
            used.add((i, j))
            pa, pb = ctx["papers"][ctx["claims"][i]["paper"]], ctx["papers"][ctx["claims"][j]["paper"]]
            chosen.append({"a": i, "b": j, "explanation": (
                f"{paper_label(pa)} reports a positive result while {paper_label(pb)} reports a limitation on "
                f"overlapping terms ({', '.join(shared[:3])}). Check whether model size, hardware or benchmarks differ.")})
            if len(chosen) == 3:
                break
        ctx["contradictions"] = chosen
    n = len(ctx["contradictions"])
    executor = "sample" if ctx["canned"] else "heuristic"
    return (f"{n} contradiction{'s' if n != 1 else ''} flagged" if n else "No contradictions found"), executor


def step_confidence(ctx: dict, q: dict) -> tuple[str, str]:
    if not ctx["canned"]:
        supporting = sum(1 for c in ctx["claims"] if c["stance"] == "supports")
        limiting = sum(1 for c in ctx["claims"] if c["stance"] == "limits")
        total = supporting + limiting
        ratio = (supporting + 1) / (total + 2)
        coverage = min(1.0, total / 8)
        ctx["score"] = round(min(0.9, max(0.2, ratio * (0.6 + 0.4 * coverage))), 2)
        ctx["rationale"] = (
            f"{supporting} supporting and {limiting} limiting claims across {len(ctx['papers'])} papers. "
            f"Smoothed support ratio {ratio:.2f}, scaled by evidence coverage {coverage:.2f}. "
            "Demo heuristic: live mode asks the routed model for a calibrated score.")
    return f"Confidence {round(ctx['score'] * 100)}%", "sample" if ctx["canned"] else "heuristic"


def step_dead_ends(ctx: dict, q: dict) -> tuple[str, str]:
    if not ctx["canned"]:
        limiting = [c for c in ctx["claims"] if c["stance"] == "limits"]
        supporting = [c for c in ctx["claims"] if c["stance"] == "supports"]
        ctx["dead_end"] = None
        if len(limiting) >= 2 and len(limiting) >= len(supporting):
            quotes = " ".join(f"“{c['text']}” ({paper_label(ctx['papers'][c['paper']])})" for c in limiting[:2])
            ctx["dead_end"] = {
                "title": f"Pursuing this as framed: {clip(q['question'].rstrip('?'), 90)}",
                "reason": f"Limiting evidence outweighs support. {quotes}",
                "revisit": "Revisit when new results address the limitations quoted above.",
                "papers": sorted({c["paper"] for c in limiting}),
            }
    found = ctx["dead_end"] is not None
    return ("1 dead end proposed" if found else "No dead ends proposed"), "sample" if ctx["canned"] else "heuristic"


def step_synthesis(ctx: dict, q: dict) -> tuple[str, str]:
    if ctx["canned"]:
        return "Briefing and draft belief written", "sample"
    supporting = [c for c in ctx["claims"] if c["stance"] == "supports"]
    limiting = [c for c in ctx["claims"] if c["stance"] == "limits"]
    lean = "yes" if ctx["score"] >= 0.62 else "mixed" if ctx["score"] >= 0.45 else "no"
    lines = [f"**Bottom line:** Evidence leans {lean}. {len(supporting)} of {len(ctx['claims'])} extracted claims "
             f"support the question and {len(limiting)} raise limitations. (Demo heuristic: connect a provider "
             "for a written analysis.)"]
    if supporting:
        lines += ["", "**Strongest support**"]
        lines += [f"- “{c['text']}” — {paper_label(ctx['papers'][c['paper']])}" for c in supporting[:3]]
    if limiting:
        lines += ["", "**Limitations and open questions**"]
        lines += [f"- “{c['text']}” — {paper_label(ctx['papers'][c['paper']])}" for c in limiting[:3]]
    next_step = ("Review the draft belief, tighten its wording, and approve it." if lean == "yes" else
                 "Narrow the question (model size, hardware, workload) and re-run, or log a dead end if the limits hold.")
    lines += ["", f"**Suggested next step:** {next_step}"]
    ctx["synthesis"] = "\n".join(lines)
    ctx["belief"] = f"Leans {lean}: {q['question'].strip()}"
    return "Briefing and draft belief written", "heuristic"


STEP_FUNCS = {"search": step_search, "extract": step_extract, "claims": step_claims,
              "contradictions": step_contradictions, "confidence": step_confidence,
              "dead_ends": step_dead_ends, "synthesis": step_synthesis}


# --------------------------------------------------------------------------- run executor

def start_run(qid: str, forced: Optional[str], canned: Optional[dict] = None,
              step_seconds: Optional[float] = None) -> str:
    rid = new_id("r")
    DB["runs"][rid] = {"id": rid, "questionId": qid, "status": "running", "startedAt": now(), "finishedAt": None,
                       "origin": "sample" if canned else "demo", "forcedProvider": forced,
                       "steps": [blank_step(s) for s in STEPS], "findings": None, "error": None}
    q = DB["questions"][qid]
    q["runIds"].append(rid)
    q["updatedAt"] = now()
    threading.Thread(target=execute_run, args=(rid, canned, step_seconds or STEP_SECONDS), daemon=True).start()
    return rid


def fail_run(rid: str, index: int, message: str) -> None:
    with LOCK:
        run = DB["runs"].get(rid)
        if not run or run["status"] != "running":
            return
        step = run["steps"][index]
        step.update(status="failed", finishedAt=now(), detail=message)
        for later in run["steps"][index + 1:]:
            later["status"] = "skipped"
        run.update(status="failed", finishedAt=now(), error=message)
        q = DB["questions"].get(run["questionId"])
        if q:
            q["updatedAt"] = now()
            log_activity("run_failed", f"couldn't finish research on “{clip(q['question'], 70)}”: {message}",
                         link={"type": "question", "id": q["id"]})


def execute_run(rid: str, canned: Optional[dict], step_seconds: float) -> None:
    ctx: dict[str, Any] = {"canned": canned is not None, "contradictions": [], "dead_end": None}
    if canned:
        ctx.update(canned)
    with LOCK:
        run = DB["runs"][rid]
        question = dict(DB["questions"][run["questionId"]])
        forced = run["forcedProvider"]
    for index, spec in enumerate(STEPS):
        with LOCK:
            if run["status"] != "running":
                return
            step = run["steps"][index]
            step.update(status="running", startedAt=now())
            if spec["task"]:
                decision = route(spec["task"], forced)
                pid = decision["routedTo"]
                step.update(routedTo=pid, routeReason=decision["reason"], fallbackFrom=decision["fallbackFrom"],
                            model=DB["providers"][pid]["model"] or None)
        started = time.monotonic()
        try:
            detail, executor = STEP_FUNCS[spec["key"]](ctx, question)
        except StepError as exc:
            fail_run(rid, index, str(exc))
            return
        except Exception as exc:  # keep the run inspectable instead of leaving it stuck as "running"
            fail_run(rid, index, f"Unexpected error: {exc}")
            return
        remaining = step_seconds - (time.monotonic() - started)
        if remaining > 0:
            time.sleep(remaining)
        with LOCK:
            if run["status"] != "running":
                return
            step.update(status="done", finishedAt=now(), detail=detail, executor=executor)
            if spec["task"]:
                elapsed = int((step["finishedAt"] - step["startedAt"]).total_seconds() * 1000)
                add_task(at=step["finishedAt"], task=spec["task"], provider="demo", routed_to=step["routedTo"],
                         model=None, tin=0, tout=0, latency_ms=elapsed, status="ok", fallback_from=None,
                         question_id=question["id"], mode="sample" if canned else "demo", reason=step["routeReason"])
    with LOCK:
        finalize(rid, ctx)


def finalize(rid: str, ctx: dict) -> None:
    run = DB["runs"].get(rid)
    if not run or run["status"] != "running":
        return
    q = DB["questions"].get(run["questionId"])
    if not q:
        return
    pids = [add_paper(title=p["title"], authors=p["authors"], year=p["year"], summary=p["summary"],
                      summary_kind=p.get("summaryKind", "abstract"), arxiv_id=p.get("arxivId"),
                      published=p.get("published"), pdf=p.get("pdfUrl"), et_al=p.get("etAl", False), pid=p.get("pid"))
            for p in ctx["papers"]]
    for bid in [b["id"] for b in DB["beliefs"].values() if b["questionId"] == q["id"] and b["status"] == "proposed"]:
        del DB["beliefs"][bid]
    for did in [d["id"] for d in DB["dead_ends"].values() if d["questionId"] == q["id"] and d["status"] == "proposed"]:
        del DB["dead_ends"][did]
    supporting_sources = [pids[c["paper"]] for c in ctx["claims"] if c["stance"] == "supports"]
    bid = new_id("b")
    make_belief(bid, statement=ctx["belief"], confidence=ctx["score"], status="proposed", question_id=q["id"],
                sources=list(dict.fromkeys(supporting_sources or pids)), evidence=ctx["rationale"], created=now(),
                history=[{"at": now(), "confidence": ctx["score"], "event": "Drafted by research run", "by": "agent"}])
    dead_end_ids = []
    if ctx.get("dead_end"):
        did = new_id("d")
        de = ctx["dead_end"]
        make_dead_end(did, title=de["title"], reason=de["reason"], revisit=de["revisit"], status="proposed",
                      question_id=q["id"], related=[pids[i] for i in de["papers"]], created=now())
        dead_end_ids.append(did)
    attach_findings(run, claims=[(pids[c["paper"]], c["text"], c["stance"], c["kind"]) for c in ctx["claims"]],
                    contradictions=[(x["a"], x["b"], x["explanation"]) for x in ctx["contradictions"]],
                    score=ctx["score"], rationale=ctx["rationale"], synthesis=ctx["synthesis"],
                    screened=ctx["screened"], belief=bid, dead_ends=dead_end_ids)
    run.update(status="completed", finishedAt=now())
    q["lastRunAt"] = q["updatedAt"] = now()
    log_activity("run_completed",
                 f"finished research on “{clip(q['question'], 70)}”: {len(set(pids))} papers, draft belief at "
                 f"{round(ctx['score'] * 100)}%", link={"type": "question", "id": q["id"]})


# --------------------------------------------------------------------------- meetings

STANCE_PATTERNS = [
    ("conditional", re.compile(r"\b(only if|as long as|provided that|depends on|it depends|unless|but only|if we can)\b", re.I)),
    ("disagree", re.compile(r"\b(disagree|don't agree|do not agree|not convinced|don't think|do not think|against|"
                            r"won't work|will not work|bad idea|skeptical|sceptical|concerned|i doubt|shouldn't|should not)\b", re.I)),
    ("unsure", re.compile(r"\b(not sure|unsure|don't know|do not know|unclear|need more data|need (the )?numbers|"
                          r"undecided|maybe|on the fence)\b", re.I)),
    ("agree", re.compile(r"\b(agree|agreed|in favou?r|support|let's do|let us do|sounds good|makes sense|i like|"
                         r"go ahead|on board|should try|happy to|yes)\b", re.I)),
]
SPEAKER_LINE = re.compile(r"^\s*(?:\[[^\]]*\]\s*)?([A-Z][\w.'-]*(?: [A-Z][\w.'-]*){0,2})\s*:\s*(.+)$")


def classify_stance(text: str) -> Optional[str]:
    for label, pattern in STANCE_PATTERNS:
        if pattern.search(text):
            return label
    return None


def match_member(speaker: str) -> Optional[str]:
    s = speaker.lower()
    for m in DB["members"].values():
        if s == m["name"].lower() or s == m["name"].split()[0].lower():
            return m["id"]
    return None


def extract_stances(transcript: str, topics: list[str]) -> tuple[list[dict], list[str], list[str]]:
    topic_stems = [{w[:5] for w in content_words(t)} for t in topics]
    current = 0
    found: dict[tuple[str, int], dict] = {}
    speakers: list[str] = []
    for line in transcript.splitlines():
        match = SPEAKER_LINE.match(line)
        if not match:
            continue
        speaker, text = match.group(1).strip(), match.group(2).strip()
        if speaker not in speakers:
            speakers.append(speaker)
        words = {w[:5] for w in content_words(text)}
        overlaps = [len(words & stems) for stems in topic_stems]
        if overlaps and max(overlaps) > 0:
            current = overlaps.index(max(overlaps))
        stance = classify_stance(text)
        if stance:
            found[(speaker, current)] = {"id": new_id("s"), "memberId": match_member(speaker), "speaker": speaker,
                                         "topic": topics[current], "stance": stance, "quote": text, "verified": False}
    member_ids = [mid for mid in (match_member(s) for s in speakers) if mid]
    unknown = [s for s in speakers if not match_member(s)]
    return list(found.values()), member_ids, unknown


# --------------------------------------------------------------------------- seed data

SEED_PAPERS = [
    ("p_kivi", "2402.02750", "KIVI: A Tuning-Free Asymmetric 2bit Quantization for KV Cache", "Zirui Liu", 2024,
     "Quantizes the KV cache to 2 bits without fine-tuning: keys per channel, values per token, with the most recent "
     "tokens kept in full precision.", False, 6),
    ("p_kvquant", "2401.18079", "KVQuant: Towards 10 Million Context Length LLM Inference with KV Cache Quantization",
     "Coleman Hooper", 2024, "Low-bit KV cache quantization for very long contexts, using per-channel key quantization "
     "applied before rotary embeddings and non-uniform datatypes.", False, 6),
    ("p_vllm", "2309.06180", "Efficient Memory Management for Large Language Model Serving with PagedAttention",
     "Woosuk Kwon", 2023, "Stores the KV cache in fixed-size blocks, like virtual-memory pages, cutting fragmentation "
     "and enabling sharing so more requests fit in GPU memory.", False, 21),
    ("p_flash", "2205.14135", "FlashAttention: Fast and Memory-Efficient Exact Attention with IO-Awareness", "Tri Dao",
     2022, "Exact attention that tiles the computation to cut reads and writes to GPU high-bandwidth memory, improving "
     "speed and memory use without approximation.", False, 40),
    ("p_flash2", "2307.08691", "FlashAttention-2: Faster Attention with Better Parallelism and Work Partitioning",
     "Tri Dao", 2023, "Reworks FlashAttention's parallelism and work partitioning to use GPU compute more efficiently.",
     True, 40),
    ("p_h2o", "2306.14048", "H2O: Heavy-Hitter Oracle for Efficient Generative Inference of Large Language Models",
     "Zhenyu Zhang", 2023, "Evicts KV entries with a policy that keeps the most-attended 'heavy hitter' tokens plus "
     "recent ones, shrinking the cache.", False, 12),
    ("p_streaming", "2309.17453", "Efficient Streaming Language Models with Attention Sinks", "Guangxuan Xiao", 2023,
     "Keeps a few initial 'attention sink' tokens plus a sliding window so generation stays stable over long streams; "
     "it does not let the model recall content that has been evicted.", False, 12),
    ("p_smoothquant", "2211.10438",
     "SmoothQuant: Accurate and Efficient Post-Training Quantization for Large Language Models", "Guangxuan Xiao", 2022,
     "Migrates quantization difficulty from activations to weights with a per-channel smoothing transform, enabling "
     "INT8 weights and activations.", False, 27),
    ("p_int8", "2208.07339", "LLM.int8(): 8-bit Matrix Multiplication for Transformers at Scale", "Tim Dettmers", 2022,
     "8-bit matrix multiplication that isolates emergent outlier features in a mixed-precision decomposition to keep "
     "quality at large scale.", False, 27),
    ("p_gptq", "2210.17323", "GPTQ: Accurate Post-Training Quantization for Generative Pre-trained Transformers",
     "Elias Frantar", 2022, "One-shot post-training weight quantization using approximate second-order information, "
     "down to 3–4 bits per weight.", False, 33),
    ("p_awq", "2306.00978", "AWQ: Activation-aware Weight Quantization for LLM Compression and Acceleration", "Ji Lin",
     2023, "Weight-only quantization that protects the most salient weight channels, chosen by activation magnitude.",
     False, 33),
    ("p_mpt", "1710.03740", "Mixed Precision Training", "Paulius Micikevicius", 2017,
     "Trains in FP16 while keeping an FP32 master copy of weights and using loss scaling to preserve small gradient "
     "values.", False, 15),
    ("p_fp8", "2209.05433", "FP8 Formats for Deep Learning", "Paulius Micikevicius", 2022,
     "Proposes the E4M3 and E5M2 FP8 encodings and reports FP8 training matching 16-bit baselines across a range of "
     "model types.", False, 15),
    ("p_gqa", "2305.13245", "GQA: Training Generalized Multi-Query Transformer Models from Multi-Head Checkpoints",
     "Joshua Ainslie", 2023, "Groups query heads to share key/value heads, a middle ground between multi-head and "
     "multi-query attention, and uptrains existing checkpoints to it.", False, 31),
    ("p_mqa", "1911.02150", "Fast Transformer Decoding: One Write-Head is All You Need", "Noam Shazeer", 2019,
     "Shares one key/value head across all query heads, shrinking the KV cache and speeding up incremental decoding.",
     True, 31),
]

SPECULATIVE_PAPERS = [
    {"pid": "p_specdec", "arxivId": "2211.17192", "title": "Fast Inference from Transformers via Speculative Decoding",
     "authors": ["Yaniv Leviathan"], "etAl": True, "year": 2022, "published": None, "summaryKind": "note",
     "summary": "A small draft model proposes tokens that the large model verifies in parallel, speeding up decoding "
                "without changing the output distribution."},
    {"pid": "p_specsamp", "arxivId": "2302.01318",
     "title": "Accelerating Large Language Model Decoding with Speculative Sampling", "authors": ["Charlie Chen"],
     "etAl": True, "year": 2023, "published": None, "summaryKind": "note",
     "summary": "Draft-then-verify sampling with a modified rejection scheme that preserves the target model's "
                "distribution while cutting latency."},
    {"pid": "p_medusa", "arxivId": "2401.10774",
     "title": "Medusa: Simple LLM Inference Acceleration Framework with Multiple Decoding Heads",
     "authors": ["Tianle Cai"], "etAl": True, "year": 2024, "published": None, "summaryKind": "note",
     "summary": "Adds extra decoding heads that predict several future tokens, verified with tree attention, so no "
                "separate draft model is needed."},
]

SAMPLE_STEP_PROFILE = {"search": (4, 900, 250), "extract": (9, 0, 0), "claims": (48, 52000, 3800),
                       "contradictions": (21, 14000, 1600), "confidence": (9, 5200, 450),
                       "dead_ends": (12, 6100, 700), "synthesis": (26, 16500, 2400)}


def sample_run(qid: str, started: datetime, fallback_claims: bool = False) -> dict:
    rid = new_id("r")
    t = started
    steps = []
    for spec in STEPS:
        seconds, tin, tout = SAMPLE_STEP_PROFILE[spec["key"]]
        step = blank_step(spec)
        step.update(status="done", startedAt=t, finishedAt=t + timedelta(seconds=seconds))
        if spec["task"]:
            rule = DB["routing"]["rules"][spec["task"]]
            pid, reason, fallback_from, status = rule["primary"], TASKS[spec["task"]]["reason"], None, "ok"
            if fallback_claims and spec["key"] == "claims":
                fallback_from, pid, status = pid, rule["fallback"], "fallback"
                reason = f"{reason} · Claude rate-limited (HTTP 429), retried on OpenAI"
            model = PROVIDER_META[pid]["defaultModel"]
            step.update(routedTo=pid, model=model, routeReason=reason, executor="llm", inputTokens=tin,
                        outputTokens=tout, costUsd=cost_of(pid, model, tin, tout), fallbackFrom=fallback_from)
            add_task(at=step["finishedAt"], task=spec["task"], provider=pid, routed_to=pid, model=model, tin=tin,
                     tout=tout, latency_ms=seconds * 1000, status=status, fallback_from=fallback_from,
                     question_id=qid, mode="sample", reason=reason)
        else:
            step["executor"] = "local"
        steps.append(step)
        t = step["finishedAt"]
    run = {"id": rid, "questionId": qid, "status": "completed", "startedAt": started, "finishedAt": t,
           "origin": "sample", "forcedProvider": None, "steps": steps, "findings": None, "error": None}
    DB["runs"][rid] = run
    DB["questions"][qid]["runIds"].append(rid)
    DB["questions"][qid]["lastRunAt"] = t
    return run


def describe_sample_steps(run: dict) -> None:
    f = run["findings"]
    details = {
        "search": f"Found {f['screened']} candidate papers",
        "extract": f"Parsed {len(f['paperIds'])} relevant papers into passages",
        "claims": f"{len(f['claimIds'])} claims from {len(f['paperIds'])} papers",
        "contradictions": (f"{len(f['contradictionIds'])} contradiction(s) flagged" if f["contradictionIds"]
                           else "No contradictions found"),
        "confidence": f"Confidence {round(f['confidence']['score'] * 100)}%",
        "dead_ends": f"{len(f['deadEndIds'])} dead end proposed" if f["deadEndIds"] else "No dead ends proposed",
        "synthesis": "Briefing and draft belief written",
    }
    for step in run["steps"]:
        step["detail"] = details[step["key"]]


def seed() -> None:
    DB["team"] = {"name": "Inference Platform", "projectName": "LLM serving cost reduction",
                  "projectEndDate": "2027-03-31", "createdAt": ago(days=45)}
    DB["settings"] = {"monthlyBudgetUsd": 50.0, "alertThreshold": 0.8, "maxPapers": 12, "backgroundWatch": True,
                      "groqFreeTier": True, "retentionMonths": 3}
    for mid, name, email, role, days in [
        ("m_you", "Demo Admin", "admin@example.com", "lead", 45),
        ("m_priya", "Priya Raman", "priya.raman@example.com", "lead", 44),
        ("m_marco", "Marco Silva", "marco.silva@example.com", "engineer", 40),
        ("m_aisha", "Aisha Khan", "aisha.khan@example.com", "researcher", 38),
        ("m_tom", "Tom Becker", "tom.becker@example.com", "engineer", 30),
        ("m_lena", "Lena Park", "lena.park@example.com", "researcher", 21),
    ]:
        DB["members"][mid] = {"id": mid, "name": name, "email": email, "role": role, "joinedAt": ago(days=days)}
    for pid, meta in PROVIDER_META.items():
        DB["providers"][pid] = {"id": pid, "model": meta["defaultModel"], "baseUrl": "", "enabled": True,
                                "status": "not_configured", "lastTestedAt": None, "lastTestMessage": None,
                                "lastLatencyMs": None}
    DB["routing"] = {"autoFallback": True, "allowOverride": True}
    apply_preset("quality")

    for pid, arxiv_id, title, author, year, summary, sole_author, days in SEED_PAPERS:
        add_paper(pid=pid, arxiv_id=arxiv_id, title=title, authors=[author], et_al=not sole_author, year=year,
                  summary=summary, summary_kind="note", added_at=ago(days=days, hours=2))

    seed_research()
    seed_meetings()
    seed_background_tasks()
    seed_activity()
    load_env_keys()


def seed_research() -> None:
    # Answered: paged KV allocation
    q3 = new_question("q_paged", "Does paged KV-cache allocation raise serving throughput compared with contiguous "
                      "allocation?", "Our serving stack pre-allocates KV memory for the maximum sequence length.",
                      "m_tom", ago(days=19))
    run = sample_run(q3["id"], ago(days=18, hours=4))
    make_belief("b_paged", statement="Paged KV-cache allocation (PagedAttention-style) substantially raises serving "
                "throughput over contiguous allocation by cutting memory fragmentation.", confidence=0.91,
                status="active", question_id=q3["id"], sources=["p_vllm", "p_mqa"],
                evidence="Block-based KV allocation nearly eliminates fragmentation, so more sequences fit in memory; "
                         "throughput gains follow from higher batch occupancy. Replicated on staging.",
                created=ago(days=18), approved_by="m_tom", approved_at=ago(days=17), history=[
                    {"at": ago(days=18), "confidence": 0.72, "event": "Drafted by research run", "by": "agent"},
                    {"at": ago(days=17), "confidence": 0.72, "event": "Approved", "by": "m_tom"},
                    {"at": ago(days=9), "confidence": 0.84, "event": "Re-scored after 2 new papers", "by": "agent"},
                    {"at": ago(days=3), "confidence": 0.91, "event": "Raised after staging replication", "by": "m_marco"},
                ])
    attach_findings(run, claims=[
        ("p_vllm", "Allocating the KV cache in fixed-size blocks nearly eliminates fragmentation, so more sequences fit "
                   "in GPU memory at once.", "supports", "summary"),
        ("p_vllm", "Higher batch occupancy from better KV memory use turns into higher serving throughput than "
                   "contiguous-allocation systems at similar latency.", "supports", "summary"),
        ("p_mqa", "Incremental decoding is bound by loading keys and values from memory, so KV memory layout and size "
                  "drive decode cost.", "neutral", "summary"),
    ], contradictions=[], score=0.72, rationale="Two supporting claims from the PagedAttention paper and one "
       "neutral claim; no limiting evidence found.", synthesis=(
        "**Bottom line:** Yes. Paged KV allocation raises throughput because far less KV memory is wasted, so more "
        "requests run concurrently.\n\n**What the evidence says**\n- Fixed-size KV blocks nearly eliminate "
        "fragmentation compared with pre-allocating for the maximum length.\n- The throughput gain comes from batch "
        "occupancy, not from faster kernels.\n\n**Suggested next step:** Move the serving stack to block-based KV "
        "allocation and re-measure throughput at our p50 latency target."),
       screened=11, belief="b_paged", dead_ends=[])
    describe_sample_steps(run)

    # Answered: FP8 fine-tuning
    q4 = new_question("q_fp8", "Should we move fine-tuning to FP8 mixed precision on H100s?",
                      "Fine-tuning 7B–13B models; currently BF16 with FP32 master weights.", "m_priya", ago(days=15))
    run = sample_run(q4["id"], ago(days=14, hours=2))
    make_belief("b_fp8", statement="FP8 mixed precision can match 16-bit fine-tuning quality on our model sizes, "
                "provided we keep FP32 master weights and per-tensor scaling.", confidence=0.78, status="active",
                question_id=q4["id"], sources=["p_fp8", "p_mpt"],
                evidence="FP8 training matched 16-bit baselines across architectures up to very large models; mixed "
                         "precision depends on FP32 master weights and loss scaling.",
                created=ago(days=14), approved_by="m_priya", approved_at=ago(days=13), history=[
                    {"at": ago(days=14), "confidence": 0.70, "event": "Drafted by research run", "by": "agent"},
                    {"at": ago(days=13), "confidence": 0.70, "event": "Approved", "by": "m_priya"},
                    {"at": ago(days=4), "confidence": 0.78, "event": "Re-scored after pilot fine-tune", "by": "agent"},
                ])
    attach_findings(run, claims=[
        ("p_fp8", "FP8 training with the E4M3 and E5M2 encodings matched 16-bit result quality across CNNs, RNNs and "
                  "Transformers, without changing hyperparameters.", "supports", "summary"),
        ("p_mpt", "Mixed precision keeps an FP32 master copy of weights and uses loss scaling so small gradient values "
                  "survive reduced precision.", "supports", "summary"),
        ("p_mpt", "Without loss scaling, small gradients underflow in reduced precision and training can diverge.",
         "limits", "summary"),
    ], contradictions=[], score=0.7, rationale="Two supporting claims and one limiting caveat that is addressed by "
       "standard loss scaling.", synthesis=(
        "**Bottom line:** Yes, with guard rails. FP8 matched 16-bit quality in published training runs, and the "
        "failure modes are known and avoidable.\n\n**What the evidence says**\n- FP8 (E4M3/E5M2) training matched "
        "16-bit baselines across model families.\n- Mixed precision depends on FP32 master weights and loss scaling."
        "\n\n**Open questions**\n- Published results cover pre-training; confirm on our fine-tuning recipes.\n\n"
        "**Suggested next step:** Run one 7B fine-tune in FP8 and compare eval scores with the BF16 baseline."),
       screened=9, belief="b_fp8", dead_ends=[])
    describe_sample_steps(run)

    # Answered with a dead end: sink + window eviction
    q5 = new_question("q_sink", "Can sink-plus-window KV eviction replace a full KV cache for 100k-token document QA?",
                      "Long-document QA where answers often depend on the first pages.", "m_lena", ago(days=12))
    run = sample_run(q5["id"], ago(days=11, hours=3), fallback_claims=True)
    make_belief("b_sink", statement="Sink-plus-window or heavy-hitter KV eviction cannot replace a full KV cache for "
                "document QA when answers depend on early content.", confidence=0.83, status="active",
                question_id=q5["id"], sources=["p_streaming", "p_h2o"],
                evidence="StreamingLLM keeps generation stable but evicted content cannot be recalled; eviction "
                         "benchmarks mostly test local context.",
                created=ago(days=11), approved_by="m_lena", approved_at=ago(days=10), history=[
                    {"at": ago(days=11), "confidence": 0.76, "event": "Drafted by research run", "by": "agent"},
                    {"at": ago(days=10), "confidence": 0.76, "event": "Approved", "by": "m_lena"},
                    {"at": ago(days=5), "confidence": 0.83, "event": "Raised after internal long-doc eval",
                     "by": "m_aisha"},
                ])
    make_dead_end("d_sink", title="Replacing the full KV cache with sink + sliding-window eviction for long-document QA",
                  reason="Evicted tokens are gone. StreamingLLM keeps generation stable over long streams but does not "
                         "let the model recall content outside the window, and heavy-hitter eviction (H2O) drops tokens "
                         "that later questions may need.",
                  revisit="Revisit if an eviction or compression method matches full-cache accuracy on our 100k-token "
                          "QA eval.", status="confirmed", question_id=q5["id"], related=["p_streaming", "p_h2o"],
                  created=ago(days=11), decided_by="m_lena", decided_at=ago(days=10))
    attach_findings(run, claims=[
        ("p_streaming", "Keeping a few initial attention-sink tokens plus a recent window keeps generation stable over "
                        "very long inputs.", "neutral", "summary"),
        ("p_streaming", "The method does not extend the context window: content that falls outside the window can no "
                        "longer be recalled.", "limits", "summary"),
        ("p_h2o", "Keeping heavy-hitter tokens plus recent tokens shrinks the KV cache while retaining much of the "
                  "quality on the evaluated tasks.", "supports", "summary"),
        ("p_vllm", "Paging the full KV cache reduces fragmentation, which makes keeping long contexts in memory "
                   "cheaper.", "neutral", "summary"),
    ], contradictions=[(2, 1, "H2O keeps quality on its benchmarks, but those mostly test local context. StreamingLLM "
                              "states evicted content is unrecoverable, which matters when answers sit early in a "
                              "document.")],
       score=0.76, rationale="The limiting claim directly matches our workload (answers early in long documents); the "
       "supporting claim comes from benchmarks that test local context.", synthesis=(
        "**Bottom line:** No. Eviction keeps generation stable but loses exactly the early-document content our QA "
        "needs.\n\n**What the evidence says**\n- StreamingLLM does not extend the context window; evicted tokens "
        "cannot be recalled.\n- H2O's quality holds on benchmarks that mostly test local context.\n\n**Suggested next "
        "step:** Keep the full KV cache at 100k and make it cheaper with paging instead."),
       screened=10, belief="b_sink", dead_ends=["d_sink"])
    describe_sample_steps(run)

    # Archived: naive INT8 activations (dead end)
    q6 = new_question("q_int8", "Is naive INT8 activation quantization safe for our 13B+ models?", None, "m_priya",
                      ago(days=27))
    run = sample_run(q6["id"], ago(days=26, hours=5))
    q6["archived"] = True
    make_dead_end("d_int8", title="Naive per-tensor INT8 activation quantization for 13B+ models",
                  reason="Emergent outlier features at larger scales break naive INT8 activation quantization. Both "
                         "LLM.int8() and SmoothQuant need explicit outlier handling to keep quality.",
                  revisit="Only with an outlier-aware scheme (mixed-precision decomposition or smoothing).",
                  status="confirmed", question_id=q6["id"], related=["p_int8", "p_smoothquant"], created=ago(days=26),
                  decided_by="m_priya", decided_at=ago(days=25))
    attach_findings(run, claims=[
        ("p_int8", "Outlier features emerge in activations as models grow, and naive 8-bit quantization breaks down "
                   "unless they are handled separately.", "limits", "summary"),
        ("p_smoothquant", "Activation outliers make per-tensor activation quantization hard; smoothing moves that "
                          "difficulty into the weights to recover accuracy.", "limits", "summary"),
    ], contradictions=[], score=0.24, rationale="Both claims limit the naive approach; neither supports it.",
       synthesis=("**Bottom line:** No. Naive INT8 activations fail at our model sizes because of activation outliers."
                  "\n\n**Suggested next step:** Log a dead end; consider SmoothQuant or LLM.int8() instead."),
       screened=8, belief=None, dead_ends=["d_int8"])
    describe_sample_steps(run)

    # Needs review: 2-bit KV quantization
    q1 = new_question("q_kv2bit", "Can 2-bit KV-cache quantization cut decode latency without hurting long-context "
                      "accuracy?", "We serve a 13B model at 32k context on L40S GPUs; KV memory caps our batch size at 6.",
                      "m_aisha", ago(days=6))
    run = sample_run(q1["id"], ago(days=2, hours=3))
    make_belief("b_kv2bit", statement="2-bit KV-cache quantization with per-channel keys keeps long-context accuracy "
                "close to FP16 and frees memory for larger batches; per-token latency gains depend on kernel support.",
                confidence=0.74, status="proposed", question_id=q1["id"], sources=["p_kivi", "p_kvquant"],
                evidence="KIVI and KVQuant both hold accuracy at 2–3 bits when keys are quantized per channel. Neither "
                         "measures decode latency on our hardware.",
                created=ago(days=2), history=[
                    {"at": ago(days=2), "confidence": 0.74, "event": "Drafted by research run", "by": "agent"}])
    make_dead_end("d_pertoken", title="Per-token quantization of keys at 2 bits",
                  reason="Key activations have outlier channels, so per-token key quantization loses accuracy; both "
                         "KIVI and KVQuant quantize keys per channel instead.",
                  revisit="Revisit if a per-token scheme with outlier handling matches per-channel accuracy.",
                  status="proposed", question_id=q1["id"], related=["p_kivi", "p_kvquant"], created=ago(days=2))
    attach_findings(run, claims=[
        ("p_kivi", "A 2-bit KV cache with per-channel keys and per-token values keeps accuracy close to the "
                   "full-precision baseline on the evaluated models.", "supports", "summary"),
        ("p_kivi", "The smaller KV cache allows larger batch sizes, which raises throughput.", "supports", "summary"),
        ("p_kvquant", "Per-channel, pre-RoPE key quantization and non-uniform datatypes make sub-4-bit KV caches "
                      "viable at very long context lengths.", "supports", "summary"),
        ("p_kvquant", "Uniform per-token quantization of keys loses accuracy because key activations have outlier "
                      "channels.", "limits", "summary"),
        ("p_vllm", "Throughput gains come mainly from fitting more sequences in memory, which a smaller KV cache also "
                   "enables.", "neutral", "summary"),
        ("p_h2o", "Eviction-based KV reduction trades exact recall of dropped tokens for memory savings.", "limits",
         "summary"),
    ], contradictions=[(0, 3, "Both papers agree low-bit KV caches can work, but KVQuant shows per-token key "
                              "quantization degrades accuracy; KIVI avoids this by quantizing keys per channel. The "
                              "disagreement disappears once the key quantization axis is fixed.")],
       score=0.74, rationale="Three supporting claims from two independent papers; the limiting claims point at a "
       "specific, avoidable design choice. Latency on L40S is untested.", synthesis=(
        "**Bottom line:** Likely yes for throughput, unproven for per-token latency. Two-bit KV caches hold accuracy "
        "when keys are quantized per channel, and the freed memory lets us raise batch size beyond 6.\n\n"
        "**What the evidence says**\n- KIVI and KVQuant both keep accuracy close to the 16-bit baseline at 2–3 bits, "
        "provided keys are quantized per channel.\n- KVQuant shows per-token key quantization loses accuracy because "
        "of outlier channels, so avoid it.\n- Throughput gains come from fitting more sequences in memory, the same "
        "mechanism PagedAttention exploits.\n\n**Open questions**\n- Neither paper measures decode latency on L40S; "
        "dequantization overhead may offset gains at small batch sizes.\n\n**Suggested next step:** Prototype "
        "KIVI-style quantization on staging at batch 6 → 16 and measure p50/p99 decode latency."),
       screened=12, belief="b_kv2bit", dead_ends=["d_pertoken"])
    describe_sample_steps(run)

    make_belief("b_gqa", statement="Grouped-query attention cuts KV-cache size with minimal quality loss compared with "
                "multi-head attention.", confidence=0.86, status="active", question_id=None,
                sources=["p_gqa", "p_mqa"],
                evidence="GQA sits between multi-head and multi-query attention; existing checkpoints can be uptrained.",
                created=ago(days=31), approved_by="m_aisha", approved_at=ago(days=31), history=[
                    {"at": ago(days=31), "confidence": 0.80, "event": "Added manually", "by": "m_aisha"},
                    {"at": ago(days=10), "confidence": 0.86, "event": "Re-scored after background watch",
                     "by": "agent"}])
    make_belief("b_flash", statement="IO-aware exact attention kernels (FlashAttention family) are a safe default for "
                "training and prefill.", confidence=0.94, status="active", question_id=None,
                sources=["p_flash", "p_flash2"],
                evidence="Exact (not approximate) attention with fewer HBM reads and writes; improved parallelism in v2.",
                created=ago(days=40), approved_by="m_priya", approved_at=ago(days=40), history=[
                    {"at": ago(days=40), "confidence": 0.90, "event": "Added manually", "by": "m_priya"},
                    {"at": ago(days=20), "confidence": 0.94, "event": "Re-scored after FlashAttention-2 review",
                     "by": "agent"}])

    # Running: speculative decoding (sample output, finishes ~35 s after start)
    q2 = new_question("q_spec", "Is speculative decoding worth it for our 7B chat model at batch size 8 or more?",
                      "Interactive chat with a p50 target of 40 ms per token on A100s.", "m_marco", ago(minutes=3))
    start_run(q2["id"], None, step_seconds=5.0, canned={
        "papers": SPECULATIVE_PAPERS, "screened": 9,
        "claims": [
            {"paper": 0, "stance": "supports", "kind": "summary",
             "text": "Draft-and-verify decoding speeds up generation without changing the output distribution."},
            {"paper": 1, "stance": "supports", "kind": "summary",
             "text": "Speculative sampling cuts latency for large models while preserving the target distribution."},
            {"paper": 2, "stance": "supports", "kind": "summary",
             "text": "Extra decoding heads predict several tokens per step without maintaining a separate draft model."},
            {"paper": 0, "stance": "limits", "kind": "summary",
             "text": "The speed-up relies on spare compute: decoding must be memory-bandwidth bound for parallel "
                     "verification to be nearly free."},
            {"paper": 2, "stance": "limits", "kind": "summary",
             "text": "Speed-ups depend on how often drafted tokens are accepted, which varies with the task and "
                     "sampling settings."},
        ],
        "contradictions": [{"a": 2, "b": 3, "explanation": "Reported speed-ups come from low-batch, memory-bound "
                                                           "settings. At batch 8+ the GPU has less spare compute, so "
                                                           "verification is no longer free."}],
        "score": 0.58,
        "rationale": "Three supporting claims, but the two limiting claims describe exactly our regime "
                     "(batch 8+). Evidence is indirect for our setup.",
        "synthesis": ("**Bottom line:** Promising at small batch sizes, uncertain at batch 8+. Every speed-up result "
                      "assumes spare compute during decoding.\n\n**What the evidence says**\n- Draft-and-verify and "
                      "Medusa-style heads preserve output quality while cutting latency.\n- Gains shrink as batches "
                      "grow and when drafted tokens are often rejected.\n\n**Suggested next step:** Benchmark Medusa "
                      "heads on the 7B model at batch 1, 4, 8 and 16 before committing."),
        "belief": "Speculative decoding is likely to help our 7B chat model at small batch sizes, but gains at batch "
                  "8+ need measurement because they rely on spare compute.",
    })


def seed_meetings() -> None:
    m1 = "Weekly sync: KV cache quantization"
    t1 = [
        ("Priya", "I'm in favor of trying KIVI-style 2-bit KV quantization on the staging cluster this sprint."),
        ("Marco", "I'm not convinced. Dequantization overhead on the L40S cards could eat the latency win at small "
                  "batch sizes."),
        ("Aisha", "I support it as long as keys are quantized per channel. Per-token keys lose accuracy in both papers "
                  "we read."),
        ("Tom", "Not sure yet. I need p99 numbers at batch 16 before I'd sign off on the staging rollout."),
        ("Priya", "Agreed on measuring first. Let's do the staging rollout behind a flag."),
        ("Marco", "Fine with a flag, but only if we can roll back within an hour."),
    ]
    DB["meetings"]["mt_kv"] = {
        "id": "mt_kv", "title": m1, "date": local_date(ago(days=4)).isoformat(), "createdAt": ago(days=4),
        "topics": ["2-bit KV quantization", "Staging rollout"], "extractedBy": "claude", "origin": "sample",
        "participants": ["m_priya", "m_marco", "m_aisha", "m_tom"], "unknownSpeakers": [],
        "transcript": "\n".join(f"{who}: {text}" for who, text in t1),
        "stances": [
            {"id": "s_1", "memberId": "m_priya", "speaker": "Priya", "topic": "2-bit KV quantization",
             "stance": "agree", "quote": t1[0][1], "verified": True},
            {"id": "s_2", "memberId": "m_marco", "speaker": "Marco", "topic": "2-bit KV quantization",
             "stance": "disagree", "quote": t1[1][1], "verified": True},
            {"id": "s_3", "memberId": "m_aisha", "speaker": "Aisha", "topic": "2-bit KV quantization",
             "stance": "conditional", "quote": t1[2][1], "verified": False},
            {"id": "s_4", "memberId": "m_tom", "speaker": "Tom", "topic": "Staging rollout", "stance": "unsure",
             "quote": t1[3][1], "verified": False},
            {"id": "s_5", "memberId": "m_priya", "speaker": "Priya", "topic": "Staging rollout", "stance": "agree",
             "quote": t1[4][1], "verified": True},
            {"id": "s_6", "memberId": "m_marco", "speaker": "Marco", "topic": "Staging rollout",
             "stance": "conditional", "quote": t1[5][1], "verified": False},
        ],
    }
    t2 = [
        ("Lena", "I don't think sink plus window eviction works for document QA. Answers often depend on the first "
                 "pages."),
        ("Priya", "Same view as Lena: the eviction approach should be logged as a dead end."),
        ("Tom", "I'd keep the full KV cache at 100k only if paging keeps memory under control."),
        ("Aisha", "Unclear to me. We need an eval where the answer sits outside the window."),
        ("Lena", "Let's keep the full KV cache at 100k and revisit eviction when there's a better eval."),
    ]
    DB["meetings"]["mt_long"] = {
        "id": "mt_long", "title": "Architecture review: long-context serving",
        "date": local_date(ago(days=11)).isoformat(), "createdAt": ago(days=11),
        "topics": ["Sink + window eviction", "Full KV cache at 100k"], "extractedBy": "claude", "origin": "sample",
        "participants": ["m_lena", "m_priya", "m_tom", "m_aisha"], "unknownSpeakers": [],
        "transcript": "\n".join(f"{who}: {text}" for who, text in t2),
        "stances": [
            {"id": "s_7", "memberId": "m_lena", "speaker": "Lena", "topic": "Sink + window eviction",
             "stance": "disagree", "quote": t2[0][1], "verified": True},
            {"id": "s_8", "memberId": "m_priya", "speaker": "Priya", "topic": "Sink + window eviction",
             "stance": "disagree", "quote": t2[1][1], "verified": True},
            {"id": "s_9", "memberId": "m_tom", "speaker": "Tom", "topic": "Full KV cache at 100k",
             "stance": "conditional", "quote": t2[2][1], "verified": False},
            {"id": "s_10", "memberId": "m_aisha", "speaker": "Aisha", "topic": "Sink + window eviction",
             "stance": "unsure", "quote": t2[3][1], "verified": False},
            {"id": "s_11", "memberId": "m_lena", "speaker": "Lena", "topic": "Full KV cache at 100k",
             "stance": "agree", "quote": t2[4][1], "verified": True},
        ],
    }
    for at in (ago(days=4, hours=-1), ago(days=11, hours=-1)):
        add_task(at=at, task="stance_extraction", provider="claude", routed_to="claude", model="claude-opus-5-5",
                 tin=9800, tout=1400, latency_ms=17400, status="ok", fallback_from=None, question_id=None,
                 mode="sample", reason=TASKS["stance_extraction"]["reason"])


def seed_background_tasks() -> None:
    rng = random.Random(7)
    for day in range(0, 30):
        base = ago(days=day).astimezone().replace(hour=3, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        if base > BOOT:
            continue
        for k in range(rng.randint(2, 3)):
            add_task(at=base + timedelta(minutes=7 * k), task="paper_search", provider="groq", routed_to="groq",
                     model="llama-3.3-70b-versatile", tin=rng.randint(700, 1300), tout=rng.randint(180, 320),
                     latency_ms=rng.randint(380, 900), status="ok", fallback_from=None, question_id=None,
                     mode="sample", reason="Background watch: weekly paper check")
        if day % 2 == 0:
            add_task(at=base + timedelta(minutes=31), task="claim_extraction", provider="claude", routed_to="claude",
                     model="claude-opus-5-5", tin=rng.randint(14000, 22000), tout=rng.randint(900, 1500),
                     latency_ms=rng.randint(14000, 26000), status="ok", fallback_from=None, question_id=None,
                     mode="sample", reason="Background watch: claims from a newly found paper")
            add_task(at=base + timedelta(minutes=33), task="quote_verification", provider="groq", routed_to="groq",
                     model="llama-3.3-70b-versatile", tin=rng.randint(1500, 3000), tout=rng.randint(80, 200),
                     latency_ms=rng.randint(300, 700), status="ok", fallback_from=None, question_id=None,
                     mode="sample", reason=TASKS["quote_verification"]["reason"])
        if day in (3, 5, 9):
            add_task(at=base + timedelta(hours=9), task="confidence_scoring", provider="claude", routed_to="claude",
                     model="claude-opus-5-5", tin=5400, tout=480, latency_ms=8800, status="ok", fallback_from=None,
                     question_id=None, mode="sample", reason="Re-scoring a belief after new evidence")
    DB["tasks"].sort(key=lambda t: t["at"])


def seed_activity() -> None:
    entries = [
        (ago(days=19), "question_created", "m_tom", "asked “Does paged KV-cache allocation raise serving throughput?”",
         {"type": "question", "id": "q_paged"}),
        (ago(days=17), "belief_approved", "m_tom", "approved a belief on paged KV allocation (72%)",
         {"type": "belief", "id": "b_paged"}),
        (ago(days=13), "belief_approved", "m_priya", "approved a belief on FP8 fine-tuning (70%)",
         {"type": "belief", "id": "b_fp8"}),
        (ago(days=11), "meeting_processed", "agent", "extracted 5 stances from “Architecture review: long-context "
         "serving”", {"type": "meeting", "id": "mt_long"}),
        (ago(days=10), "dead_end_confirmed", "m_lena", "ruled out sink + window eviction for long-document QA",
         {"type": "dead_end", "id": "d_sink"}),
        (ago(days=9), "belief_rescored", "agent", "raised paged KV allocation to 84% after 2 new papers",
         {"type": "belief", "id": "b_paged"}),
        (ago(days=6), "question_created", "m_aisha", "asked “Can 2-bit KV-cache quantization cut decode latency?”",
         {"type": "question", "id": "q_kv2bit"}),
        (ago(days=6, hours=-1), "paper_added", "agent", "added KIVI and KVQuant to the library",
         {"type": "paper", "id": "p_kivi"}),
        (ago(days=4), "meeting_processed", "agent", "extracted 6 stances from “Weekly sync: KV cache quantization”",
         {"type": "meeting", "id": "mt_kv"}),
        (ago(days=3), "belief_rescored", "m_marco", "raised paged KV allocation to 91% after staging replication",
         {"type": "belief", "id": "b_paged"}),
        (ago(days=2), "run_completed", "agent", "finished research on 2-bit KV quantization: draft belief at 74%",
         {"type": "question", "id": "q_kv2bit"}),
        (ago(minutes=3), "question_created", "m_marco", "asked “Is speculative decoding worth it at batch 8+?”",
         {"type": "question", "id": "q_spec"}),
    ]
    for at, kind, actor, text, link in entries:
        log_activity(kind, text, actor=actor, link=link, at=at)


def load_env_keys() -> None:
    env: dict[str, str] = {}
    env_file = Path(__file__).with_name(".env")
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                env[key.strip()] = value.strip().strip('"').strip("'")
    env.update(os.environ)
    for pid, var in (("claude", "ANTHROPIC_API_KEY"), ("openai", "OPENAI_API_KEY"), ("groq", "GROQ_API_KEY")):
        value = env.get(var, "")
        if value and "placeholder" not in value.lower() and not value.endswith("..."):
            KEYS[pid] = value
            DB["providers"][pid]["status"] = "untested"


# --------------------------------------------------------------------------- serializers

def member_public(m: dict) -> dict:
    return {k: m[k] for k in ("id", "name", "email", "role", "joinedAt")}


def paper_brief(p: dict) -> dict:
    return {k: p[k] for k in ("id", "arxivId", "title", "authors", "etAl", "year", "url")}


def paper_public(p: dict) -> dict:
    claims = [c for c in DB["claims"].values() if c["paperId"] == p["id"]]
    beliefs = [b for b in DB["beliefs"].values() if p["id"] in b["sources"] and b["status"] in ("active", "proposed")]
    data = {k: p[k] for k in ("id", "arxivId", "title", "authors", "etAl", "year", "published", "source", "url",
                              "pdfUrl", "summary", "summaryKind", "addedAt", "addedBy")}
    data.update(claimCount=len(claims), beliefCount=len(beliefs),
                questionIds=sorted({c["questionId"] for c in claims}))
    return data


def claim_public(c: dict) -> dict:
    paper = DB["papers"].get(c["paperId"])
    return {**{k: c[k] for k in ("id", "paperId", "questionId", "text", "kind", "stance")},
            "paper": paper_brief(paper) if paper else None}


def belief_public(b: dict) -> dict:
    q = DB["questions"].get(b["questionId"] or "")
    return {**{k: b[k] for k in ("id", "statement", "confidence", "status", "questionId", "sources", "evidence",
                                 "createdAt", "updatedAt", "approvedBy", "approvedAt", "history")},
            "question": {"id": q["id"], "question": q["question"]} if q else None,
            "sourcePapers": [paper_brief(DB["papers"][pid]) for pid in b["sources"] if pid in DB["papers"]]}


def dead_end_public(d: dict) -> dict:
    q = DB["questions"].get(d["questionId"] or "")
    return {**{k: d[k] for k in ("id", "title", "reason", "revisitTrigger", "status", "questionId", "relatedPapers",
                                 "createdAt", "createdBy", "decidedBy", "decidedAt")},
            "question": {"id": q["id"], "question": q["question"]} if q else None,
            "papers": [paper_brief(DB["papers"][pid]) for pid in d["relatedPapers"] if pid in DB["papers"]]}


def run_progress(run: dict) -> float:
    done = sum(1 for s in run["steps"] if s["status"] in ("done", "skipped", "failed"))
    running = any(s["status"] == "running" for s in run["steps"])
    return round((done + (0.5 if running else 0)) / len(run["steps"]), 3)


def run_public(run: dict, full: bool = False) -> dict:
    current = next((i for i, s in enumerate(run["steps"]) if s["status"] == "running"), None)
    data = {k: run[k] for k in ("id", "status", "startedAt", "finishedAt", "origin", "forcedProvider", "error")}
    data.update(progress=run_progress(run), currentStep=current,
                currentLabel=run["steps"][current]["label"] if current is not None else None,
                currentProvider=run["steps"][current]["routedTo"] if current is not None else None)
    if full:
        steps = []
        for s in run["steps"]:
            end = s["finishedAt"] or (now() if s["status"] == "running" else None)
            duration = int((end - s["startedAt"]).total_seconds() * 1000) if s["startedAt"] and end else None
            steps.append({**s, "durationMs": duration})
        data["steps"] = steps
        data["totals"] = {
            "costUsd": round(sum(s["costUsd"] for s in run["steps"]), 6),
            "inputTokens": sum(s["inputTokens"] for s in run["steps"]),
            "outputTokens": sum(s["outputTokens"] for s in run["steps"]),
            "durationMs": int(((run["finishedAt"] or now()) - run["startedAt"]).total_seconds() * 1000),
        }
    return data


def question_runs(q: dict) -> list[dict]:
    return [DB["runs"][rid] for rid in q["runIds"] if rid in DB["runs"]]


def question_belief(qid: str) -> Optional[dict]:
    beliefs = [b for b in DB["beliefs"].values() if b["questionId"] == qid]
    for status in ("proposed", "active"):
        match = [b for b in beliefs if b["status"] == status]
        if match:
            return max(match, key=lambda b: b["createdAt"])
    return max(beliefs, key=lambda b: b["createdAt"]) if beliefs else None


def question_status(q: dict) -> str:
    if q["archived"]:
        return "archived"
    runs = question_runs(q)
    latest = runs[-1] if runs else None
    if latest and latest["status"] == "running":
        return "running"
    if latest and latest["status"] == "failed":
        return "failed"
    belief = question_belief(q["id"])
    pending_dead_ends = any(d["questionId"] == q["id"] and d["status"] == "proposed" for d in DB["dead_ends"].values())
    if (belief and belief["status"] == "proposed") or pending_dead_ends:
        return "needs_review"
    if (belief and belief["status"] == "active") or any(
            d["questionId"] == q["id"] and d["status"] == "confirmed" for d in DB["dead_ends"].values()):
        return "answered"
    return "open"


def latest_findings_run(q: dict) -> Optional[dict]:
    completed = [r for r in question_runs(q) if r["status"] == "completed" and r["findings"]]
    return completed[-1] if completed else None


def question_public(q: dict, full: bool = False) -> dict:
    runs = question_runs(q)
    latest = runs[-1] if runs else None
    findings_run = latest_findings_run(q)
    belief = question_belief(q["id"])
    pending = sum(1 for d in DB["dead_ends"].values() if d["questionId"] == q["id"] and d["status"] == "proposed")
    pending += 1 if belief and belief["status"] == "proposed" else 0
    data = {k: q[k] for k in ("id", "question", "context", "createdBy", "createdAt", "updatedAt", "lastRunAt",
                              "archived")}
    data.update(status=question_status(q),
                papersAnalyzed=len(findings_run["findings"]["paperIds"]) if findings_run else 0,
                confidence=belief["confidence"] if belief else None, beliefId=belief["id"] if belief else None,
                beliefStatus=belief["status"] if belief else None, pendingReview=pending,
                run=run_public(latest) if latest else None)
    if full:
        data["run"] = run_public(latest, full=True) if latest else None
        data["findings"] = findings_public(findings_run) if findings_run else None
        data["belief"] = belief_public(belief) if belief else None
        data["deadEnds"] = [dead_end_public(d) for d in DB["dead_ends"].values() if d["questionId"] == q["id"]]
        data["runs"] = [run_public(r, full=True) for r in reversed(runs)]
    return data


def findings_public(run: dict) -> dict:
    f = run["findings"]
    claims = [claim_public(DB["claims"][c]) for c in f["claimIds"] if c in DB["claims"]]
    by_id = {c["id"]: c for c in claims}
    contradictions = [
        {"id": x["id"], "explanation": x["explanation"], "severity": x["severity"],
         "claimA": by_id.get(x["claimA"]), "claimB": by_id.get(x["claimB"])}
        for x in (DB["contradictions"].get(xid) for xid in f["contradictionIds"]) if x
    ]
    return {"runId": run["id"], "synthesis": f["synthesis"], "confidence": f["confidence"], "screened": f["screened"],
            "claims": claims, "contradictions": contradictions,
            "papers": [paper_brief(DB["papers"][pid]) for pid in f["paperIds"] if pid in DB["papers"]]}


def provider_public(pid: str) -> dict:
    p, meta = DB["providers"][pid], PROVIDER_META[pid]
    month = local_date(now()).replace(day=1)
    tasks = [t for t in DB["tasks"] if t["provider"] == pid and local_date(t["at"]) >= month]
    latencies = [t["latencyMs"] for t in tasks]
    key = KEYS.get(pid)
    return {
        "id": pid, "name": meta["name"], "short": meta["short"], "blurb": meta["blurb"],
        "consoleUrl": meta["consoleUrl"], "keyPlaceholder": meta["keyPlaceholder"], "models": meta["models"],
        "model": p["model"], "baseUrl": p["baseUrl"], "enabled": p["enabled"], "status": p["status"],
        "hasKey": bool(key), "keyHint": f"…{key[-4:]}" if key and len(key) >= 8 else None,
        "lastTestedAt": p["lastTestedAt"], "lastTestMessage": p["lastTestMessage"], "lastLatencyMs": p["lastLatencyMs"],
        "month": {"costUsd": round(sum(t["costUsd"] for t in tasks), 4), "calls": len(tasks),
                  "tokens": sum(t["inputTokens"] + t["outputTokens"] for t in tasks),
                  "avgLatencyMs": int(sum(latencies) / len(latencies)) if latencies else None,
                  "fallbacks": sum(1 for t in tasks if t["status"] == "fallback")},
    }


def routing_public() -> dict:
    r = DB["routing"]
    return {"priority": r["priority"], "autoFallback": r["autoFallback"], "allowOverride": r["allowOverride"],
            "rules": [{"task": task, "label": TASKS[task]["label"], "description": TASKS[task]["description"],
                       **r["rules"][task]} for task in TASKS]}


def workspace_public() -> dict:
    end = DB["team"]["projectEndDate"]
    delete_on = add_months(date.fromisoformat(end), DB["settings"]["retentionMonths"]).isoformat() if end else None
    return {"team": DB["team"], "settings": DB["settings"], "retentionDeleteOn": delete_on,
            "members": [member_public(m) for m in DB["members"].values()], "currentUserId": CURRENT_USER,
            "demo": True, "providers": [{"id": pid, "short": PROVIDER_META[pid]["short"],
                                         "status": DB["providers"][pid]["status"]} for pid in PROVIDER_IDS]}


def month_spend() -> dict:
    month = local_date(now()).replace(day=1)
    tasks = [t for t in DB["tasks"] if local_date(t["at"]) >= month]
    return {"monthToDate": round(sum(t["costUsd"] for t in tasks), 4), "budget": DB["settings"]["monthlyBudgetUsd"],
            "alertThreshold": DB["settings"]["alertThreshold"],
            "byProvider": [{"provider": pid, "costUsd": round(sum(t["costUsd"] for t in tasks if t["provider"] == pid), 4),
                            "calls": sum(1 for t in tasks if t["provider"] == pid)} for pid in PROVIDER_IDS]}


# --------------------------------------------------------------------------- request bodies

class AskBody(BaseModel):
    question: str = Field(min_length=8, max_length=500)
    context: Optional[str] = Field(default=None, max_length=2000)
    provider: Optional[ProviderId] = None


class RunBody(BaseModel):
    provider: Optional[ProviderId] = None


class QuestionPatch(BaseModel):
    question: Optional[str] = Field(default=None, min_length=8, max_length=500)
    context: Optional[str] = Field(default=None, max_length=2000)
    archived: Optional[bool] = None


class ApproveBody(BaseModel):
    statement: Optional[str] = Field(default=None, min_length=4, max_length=600)


class RejectBody(BaseModel):
    reason: Optional[str] = Field(default=None, max_length=600)


class BeliefPatch(BaseModel):
    statement: Optional[str] = Field(default=None, min_length=4, max_length=600)
    status: Optional[Literal["active", "archived"]] = None


class DeadEndBody(BaseModel):
    title: str = Field(min_length=4, max_length=300)
    reason: str = Field(min_length=4, max_length=2000)
    revisitTrigger: Optional[str] = Field(default=None, max_length=600)
    questionId: Optional[str] = None


class PaperBody(BaseModel):
    ref: str = Field(min_length=4, max_length=300)


class MeetingBody(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    date: Optional[str] = None
    topics: list[str] = Field(default_factory=list)
    transcript: str = Field(min_length=10, max_length=100_000)


class StancePatch(BaseModel):
    verified: Optional[bool] = None
    stance: Optional[Literal["agree", "disagree", "conditional", "unsure"]] = None


class ProviderBody(BaseModel):
    apiKey: Optional[str] = Field(default=None, max_length=500)
    model: Optional[str] = Field(default=None, max_length=200)
    baseUrl: Optional[str] = Field(default=None, max_length=500)
    enabled: Optional[bool] = None


class RuleBody(BaseModel):
    task: str
    primary: ProviderId
    fallback: Optional[ProviderId] = None


class RoutingBody(BaseModel):
    priority: Optional[Literal["quality", "balanced", "speed", "cost"]] = None
    autoFallback: Optional[bool] = None
    allowOverride: Optional[bool] = None
    rules: Optional[list[RuleBody]] = None


class SettingsBody(BaseModel):
    teamName: Optional[str] = Field(default=None, min_length=1, max_length=120)
    projectName: Optional[str] = Field(default=None, max_length=160)
    projectEndDate: Optional[str] = None
    monthlyBudgetUsd: Optional[float] = Field(default=None, ge=0, le=100_000)
    alertThreshold: Optional[float] = Field(default=None, ge=0.1, le=1.0)
    maxPapers: Optional[int] = Field(default=None, ge=3, le=50)
    backgroundWatch: Optional[bool] = None
    groqFreeTier: Optional[bool] = None


class MemberBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    role: Literal["lead", "researcher", "engineer", "viewer"] = "researcher"


class MemberPatch(BaseModel):
    role: Literal["lead", "researcher", "engineer", "viewer"]


# --------------------------------------------------------------------------- app

app = FastAPI(title="Hindsight demo API", version="0.2.0",
              description="In-memory demo backend for the Hindsight literature scout.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def get_or_404(table: str, key: str, label: str) -> dict:
    item = DB[table].get(key)
    if not item:
        raise HTTPException(status_code=404, detail=f"{label} not found")
    return item


@app.get("/", include_in_schema=False)
def root() -> RedirectResponse:
    return RedirectResponse(FRONTEND_URL)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "mode": "demo", "startedAt": BOOT}


@app.get("/api/workspace")
def get_workspace() -> dict:
    with LOCK:
        return workspace_public()


@app.get("/api/overview")
def get_overview() -> dict:
    with LOCK:
        questions = [q for q in DB["questions"].values() if not q["archived"]]
        statuses = [question_status(q) for q in questions]
        active = [b for b in DB["beliefs"].values() if b["status"] == "active"]
        week_ago = now() - timedelta(days=7)
        running = [question_public(q) for q, s in zip(questions, statuses) if s == "running"]
        activity = sorted(DB["activity"], key=lambda a: a["at"], reverse=True)[:14]
        return {
            "stats": {"activeQuestions": len(questions), "running": statuses.count("running"),
                      "needsReview": statuses.count("needs_review"), "activeBeliefs": len(active),
                      "avgConfidence": round(sum(b["confidence"] for b in active) / len(active), 3) if active else 0,
                      "papers": len(DB["papers"]),
                      "papersThisWeek": sum(1 for p in DB["papers"].values() if p["addedAt"] >= week_ago),
                      "deadEnds": sum(1 for d in DB["dead_ends"].values() if d["status"] == "confirmed")},
            "running": running,
            "review": {"beliefs": [belief_public(b) for b in DB["beliefs"].values() if b["status"] == "proposed"],
                       "deadEnds": [dead_end_public(d) for d in DB["dead_ends"].values() if d["status"] == "proposed"]},
            "topBeliefs": [belief_public(b) for b in sorted(active, key=lambda b: -b["confidence"])[:4]],
            "spend": month_spend(),
            "activity": activity,
        }


@app.get("/api/questions")
def list_questions() -> list[dict]:
    with LOCK:
        return [question_public(q) for q in sorted(DB["questions"].values(), key=lambda q: q["updatedAt"], reverse=True)]


@app.post("/api/questions", status_code=201)
def ask_question(body: AskBody) -> dict:
    with LOCK:
        text = " ".join(body.question.split())
        q = new_question(new_id("q"), text, (body.context or "").strip() or None, CURRENT_USER, now())
        log_activity("question_created", f"asked “{clip(text, 90)}”", actor=CURRENT_USER,
                     link={"type": "question", "id": q["id"]})
        start_run(q["id"], body.provider)
        return question_public(q, full=True)


@app.get("/api/questions/{qid}")
def get_question(qid: str) -> dict:
    with LOCK:
        return question_public(get_or_404("questions", qid, "Question"), full=True)


@app.post("/api/questions/{qid}/runs", status_code=201)
def rerun_question(qid: str, body: RunBody) -> dict:
    with LOCK:
        q = get_or_404("questions", qid, "Question")
        if question_status(q) == "running":
            raise HTTPException(status_code=409, detail="Research is already running for this question")
        q["archived"] = False
        start_run(qid, body.provider)
        label = f" on {short_name(body.provider)}" if body.provider else ""
        log_activity("run_started", f"re-ran research{label} for “{clip(q['question'], 80)}”", actor=CURRENT_USER,
                     link={"type": "question", "id": qid})
        return question_public(q, full=True)


@app.patch("/api/questions/{qid}")
def update_question(qid: str, body: QuestionPatch) -> dict:
    with LOCK:
        q = get_or_404("questions", qid, "Question")
        if body.question is not None:
            q["question"] = " ".join(body.question.split())
        if body.context is not None:
            q["context"] = body.context.strip() or None
        if body.archived is not None:
            q["archived"] = body.archived
        q["updatedAt"] = now()
        return question_public(q, full=True)


@app.delete("/api/questions/{qid}", status_code=204)
def delete_question(qid: str) -> None:
    with LOCK:
        q = get_or_404("questions", qid, "Question")
        for run in question_runs(q):
            run["status"] = "cancelled"
            DB["runs"].pop(run["id"], None)
        for table in ("claims", "contradictions"):
            for key in [k for k, v in DB[table].items() if v["questionId"] == qid]:
                del DB[table][key]
        for table, keep in (("beliefs", ("active", "archived")), ("dead_ends", ("confirmed", "reopened"))):
            for key, item in list(DB[table].items()):
                if item["questionId"] == qid:
                    if item["status"] in keep:
                        item["questionId"] = None
                    else:
                        del DB[table][key]
        del DB["questions"][qid]


@app.get("/api/questions/{qid}/briefing.md")
def briefing(qid: str) -> PlainTextResponse:
    with LOCK:
        q = get_or_404("questions", qid, "Question")
        data = question_public(q, full=True)
    lines = [f"# {data['question']}", ""]
    if data["context"]:
        lines += [f"_Context: {data['context']}_", ""]
    findings = data["findings"]
    if not findings:
        lines.append("No findings yet.")
    else:
        lines += ["## Briefing", "", findings["synthesis"], ""]
        if data["belief"]:
            b = data["belief"]
            lines += ["## Belief", "", f"{b['statement']} — confidence {round(b['confidence'] * 100)}% ({b['status']})",
                      ""]
        lines += ["## Evidence", ""]
        for c in findings["claims"]:
            paper = c["paper"] or {}
            quote = f"“{c['text']}”" if c["kind"] == "quote" else c["text"]
            lines.append(f"- **{c['stance']}** — {quote} ({paper.get('title', 'unknown')}, arXiv:{paper.get('arxivId')})")
        if findings["contradictions"]:
            lines += ["", "## Contradictions", ""]
            lines += [f"- {x['explanation']}" for x in findings["contradictions"]]
        if data["deadEnds"]:
            lines += ["", "## Dead ends", ""]
            lines += [f"- **{d['title']}** ({d['status']}): {d['reason']}" for d in data["deadEnds"]]
        lines += ["", "## Papers", ""]
        lines += [f"- {p['title']} ({p['year']}) — {p['url']}" for p in findings["papers"]]
    filename = re.sub(r"[^a-z0-9]+", "-", data["question"].lower()).strip("-")[:60] or "briefing"
    return PlainTextResponse("\n".join(lines) + "\n", media_type="text/markdown; charset=utf-8",
                             headers={"Content-Disposition": f'attachment; filename="{filename}.md"'})


def refresh_question_status(qid: Optional[str]) -> None:
    q = DB["questions"].get(qid or "")
    if q:
        q["updatedAt"] = now()


@app.get("/api/beliefs")
def list_beliefs() -> list[dict]:
    with LOCK:
        return [belief_public(b) for b in sorted(DB["beliefs"].values(), key=lambda b: b["updatedAt"], reverse=True)]


@app.get("/api/beliefs/{bid}")
def get_belief(bid: str) -> dict:
    with LOCK:
        return belief_public(get_or_404("beliefs", bid, "Belief"))


@app.post("/api/beliefs/{bid}/approve")
def approve_belief(bid: str, body: ApproveBody) -> dict:
    with LOCK:
        b = get_or_404("beliefs", bid, "Belief")
        if b["status"] != "proposed":
            raise HTTPException(status_code=409, detail="Only proposed beliefs can be approved")
        edited = body.statement is not None and body.statement.strip() != b["statement"]
        if edited:
            b["statement"] = body.statement.strip()
        for other in DB["beliefs"].values():
            if other["id"] != bid and other["questionId"] and other["questionId"] == b["questionId"] \
                    and other["status"] == "active":
                other["status"] = "archived"
                other["history"].append({"at": now(), "confidence": other["confidence"],
                                         "event": "Superseded by a newer belief", "by": CURRENT_USER})
        b.update(status="active", approvedBy=CURRENT_USER, approvedAt=now(), updatedAt=now())
        b["history"].append({"at": now(), "confidence": b["confidence"],
                             "event": "Approved with edits" if edited else "Approved", "by": CURRENT_USER})
        log_activity("belief_approved", f"approved a belief ({round(b['confidence'] * 100)}%): "
                     f"“{clip(b['statement'], 90)}”", actor=CURRENT_USER, link={"type": "belief", "id": bid})
        refresh_question_status(b["questionId"])
        return belief_public(b)


@app.post("/api/beliefs/{bid}/reject")
def reject_belief(bid: str, body: RejectBody) -> dict:
    with LOCK:
        b = get_or_404("beliefs", bid, "Belief")
        if b["status"] != "proposed":
            raise HTTPException(status_code=409, detail="Only proposed beliefs can be rejected")
        reason = (body.reason or "").strip()
        b.update(status="rejected", updatedAt=now())
        b["history"].append({"at": now(), "confidence": b["confidence"],
                             "event": f"Rejected: {reason}" if reason else "Rejected", "by": CURRENT_USER})
        log_activity("belief_rejected", f"rejected a draft belief: “{clip(b['statement'], 90)}”", actor=CURRENT_USER,
                     link={"type": "belief", "id": bid})
        refresh_question_status(b["questionId"])
        return belief_public(b)


@app.patch("/api/beliefs/{bid}")
def update_belief(bid: str, body: BeliefPatch) -> dict:
    with LOCK:
        b = get_or_404("beliefs", bid, "Belief")
        if body.statement is not None:
            b["statement"] = body.statement.strip()
            b["history"].append({"at": now(), "confidence": b["confidence"], "event": "Statement edited",
                                 "by": CURRENT_USER})
        if body.status is not None and body.status != b["status"]:
            if b["status"] not in ("active", "archived"):
                raise HTTPException(status_code=409, detail="Only active or archived beliefs can change status")
            b["status"] = body.status
            b["history"].append({"at": now(), "confidence": b["confidence"],
                                 "event": "Archived" if body.status == "archived" else "Restored", "by": CURRENT_USER})
        b["updatedAt"] = now()
        return belief_public(b)


@app.get("/api/dead-ends")
def list_dead_ends() -> list[dict]:
    with LOCK:
        return [dead_end_public(d) for d in sorted(DB["dead_ends"].values(), key=lambda d: d["createdAt"], reverse=True)]


@app.post("/api/dead-ends", status_code=201)
def create_dead_end(body: DeadEndBody) -> dict:
    with LOCK:
        if body.questionId and body.questionId not in DB["questions"]:
            raise HTTPException(status_code=404, detail="Question not found")
        did = new_id("d")
        make_dead_end(did, title=body.title.strip(), reason=body.reason.strip(),
                      revisit=(body.revisitTrigger or "").strip() or None, status="confirmed",
                      question_id=body.questionId, related=[], created=now(), decided_by=CURRENT_USER,
                      decided_at=now(), created_by=CURRENT_USER)
        log_activity("dead_end_confirmed", f"logged a dead end: “{clip(body.title, 90)}”", actor=CURRENT_USER,
                     link={"type": "dead_end", "id": did})
        return dead_end_public(DB["dead_ends"][did])


@app.post("/api/dead-ends/{did}/{action}")
def dead_end_action(did: str, action: Literal["confirm", "dismiss", "reopen"]) -> dict:
    with LOCK:
        d = get_or_404("dead_ends", did, "Dead end")
        allowed = {"confirm": ("proposed", "reopened"), "dismiss": ("proposed",), "reopen": ("confirmed",)}
        if d["status"] not in allowed[action]:
            raise HTTPException(status_code=409, detail=f"Can't {action} a dead end that is {d['status']}")
        d.update(status={"confirm": "confirmed", "dismiss": "dismissed", "reopen": "reopened"}[action],
                 decidedBy=CURRENT_USER, decidedAt=now())
        verb = {"confirm": "ruled out", "dismiss": "dismissed the proposed dead end", "reopen": "reopened"}[action]
        log_activity(f"dead_end_{action}", f"{verb}: “{clip(d['title'], 90)}”", actor=CURRENT_USER,
                     link={"type": "dead_end", "id": did})
        refresh_question_status(d["questionId"])
        return dead_end_public(d)


@app.get("/api/papers")
def list_papers(q: str = "", source: str = "all") -> list[dict]:
    needle = q.strip().lower()
    with LOCK:
        papers = sorted(DB["papers"].values(), key=lambda p: p["addedAt"], reverse=True)
        out = []
        for p in papers:
            if source != "all" and p["source"] != source:
                continue
            haystack = " ".join([p["title"], " ".join(p["authors"]), p["arxivId"] or "", p["summary"]]).lower()
            if needle and needle not in haystack:
                continue
            out.append(paper_public(p))
        return out


@app.get("/api/papers/{pid}")
def get_paper(pid: str) -> dict:
    with LOCK:
        p = get_or_404("papers", pid, "Paper")
        data = paper_public(p)
        data["claims"] = []
        for c in DB["claims"].values():
            if c["paperId"] == pid:
                q = DB["questions"].get(c["questionId"])
                data["claims"].append({**claim_public(c),
                                       "question": {"id": q["id"], "question": q["question"]} if q else None})
        data["beliefs"] = [belief_public(b) for b in DB["beliefs"].values()
                           if pid in b["sources"] and b["status"] in ("active", "proposed")]
        return data


@app.post("/api/papers", status_code=201)
def add_paper_by_ref(body: PaperBody) -> dict:
    ref = body.ref.strip()
    match = re.search(r"(\d{4}\.\d{4,5})(v\d+)?", ref) or re.search(r"([a-z\-]+(?:\.[A-Z]{2})?/\d{7})", ref)
    if not match:
        raise HTTPException(status_code=422, detail="Enter an arXiv ID like 2309.06180 or an arxiv.org link")
    arxiv_id = match.group(1)
    with LOCK:
        existing = next((p for p in DB["papers"].values() if p["arxivId"] == arxiv_id), None)
        if existing:
            raise HTTPException(status_code=409, detail="That paper is already in the library")
    try:
        results = arxiv_query({"id_list": arxiv_id}, timeout=12)
    except StepError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    if not results:
        raise HTTPException(status_code=404, detail=f"arXiv has no paper with ID {arxiv_id}")
    r = results[0]
    with LOCK:
        pid = add_paper(title=r["title"], authors=r["authors"], year=r["year"], summary=r["summary"],
                        summary_kind="abstract", arxiv_id=r["arxivId"], published=r["published"], pdf=r["pdfUrl"],
                        added_by=CURRENT_USER)
        log_activity("paper_added", f"added “{clip(r['title'], 90)}” to the library", actor=CURRENT_USER,
                     link={"type": "paper", "id": pid})
        return paper_public(DB["papers"][pid])


def meeting_public(m: dict, full: bool = False) -> dict:
    data = {k: m[k] for k in ("id", "title", "date", "createdAt", "topics", "extractedBy", "origin", "participants",
                              "unknownSpeakers")}
    data["stanceCount"] = len(m["stances"])
    data["verifiedCount"] = sum(1 for s in m["stances"] if s["verified"])
    if full:
        data["transcript"] = m["transcript"]
        data["stances"] = m["stances"]
    return data


@app.get("/api/meetings")
def list_meetings() -> list[dict]:
    with LOCK:
        return [meeting_public(m) for m in sorted(DB["meetings"].values(), key=lambda m: m["date"], reverse=True)]


@app.get("/api/meetings/{mid}")
def get_meeting(mid: str) -> dict:
    with LOCK:
        return meeting_public(get_or_404("meetings", mid, "Meeting"), full=True)


@app.post("/api/meetings", status_code=201)
def create_meeting(body: MeetingBody) -> dict:
    topics = [t.strip() for t in body.topics if t.strip()][:8] or [body.title.strip()]
    if body.date:
        try:
            meeting_date = date.fromisoformat(body.date).isoformat()
        except ValueError as exc:
            raise HTTPException(status_code=422, detail="Date must be YYYY-MM-DD") from exc
    else:
        meeting_date = local_date(now()).isoformat()
    with LOCK:
        stances, participants, unknown = extract_stances(body.transcript, topics)
        if not participants and not unknown:
            raise HTTPException(status_code=422, detail="No speakers found. Format each line as “Name: what they said”.")
        mid = new_id("mt")
        decision = route("stance_extraction", None)
        DB["meetings"][mid] = {"id": mid, "title": body.title.strip(), "date": meeting_date, "createdAt": now(),
                               "topics": topics, "extractedBy": "heuristic", "origin": "demo",
                               "participants": participants, "unknownSpeakers": unknown,
                               "transcript": body.transcript.strip(), "stances": stances}
        add_task(at=now(), task="stance_extraction", provider="demo", routed_to=decision["routedTo"], model=None,
                 tin=0, tout=0, latency_ms=40, status="ok", fallback_from=None, question_id=None, mode="demo",
                 reason=decision["reason"])
        log_activity("meeting_processed", f"extracted {len(stances)} stances from “{clip(body.title, 80)}”",
                     actor=CURRENT_USER, link={"type": "meeting", "id": mid})
        return meeting_public(DB["meetings"][mid], full=True)


@app.patch("/api/meetings/{mid}/stances/{sid}")
def update_stance(mid: str, sid: str, body: StancePatch) -> dict:
    with LOCK:
        m = get_or_404("meetings", mid, "Meeting")
        stance = next((s for s in m["stances"] if s["id"] == sid), None)
        if not stance:
            raise HTTPException(status_code=404, detail="Stance not found")
        if body.verified is not None:
            stance["verified"] = body.verified
        if body.stance is not None:
            stance["stance"] = body.stance
        return meeting_public(m, full=True)


@app.delete("/api/meetings/{mid}", status_code=204)
def delete_meeting(mid: str) -> None:
    with LOCK:
        get_or_404("meetings", mid, "Meeting")
        del DB["meetings"][mid]


@app.get("/api/providers")
def list_providers() -> list[dict]:
    with LOCK:
        return [provider_public(pid) for pid in PROVIDER_IDS]


@app.put("/api/providers/{pid}")
def save_provider(pid: ProviderId, body: ProviderBody) -> dict:
    with LOCK:
        p = DB["providers"][pid]
        if body.baseUrl is not None:
            base = body.baseUrl.strip()
            if base and not re.match(r"^https?://", base):
                raise HTTPException(status_code=422, detail="Base URL must start with http:// or https://")
            p["baseUrl"] = base.rstrip("/")
        if body.model is not None:
            p["model"] = body.model.strip()
        if body.enabled is not None:
            p["enabled"] = body.enabled
        if body.apiKey is not None:
            key = body.apiKey.strip()
            if key:
                KEYS[pid] = key
                p.update(status="untested", lastTestedAt=None, lastTestMessage=None, lastLatencyMs=None)
                log_activity("provider_connected", f"saved an API key for {short_name(pid)}", actor=CURRENT_USER)
            else:
                KEYS.pop(pid, None)
                p.update(status="not_configured", lastTestedAt=None, lastTestMessage=None, lastLatencyMs=None)
        return provider_public(pid)


@app.post("/api/providers/{pid}/test")
def test_provider(pid: ProviderId) -> dict:
    with LOCK:
        key = KEYS.get(pid)
        p = DB["providers"][pid]
        base = p["baseUrl"]
    if not key:
        raise HTTPException(status_code=400, detail="Save an API key first")
    if pid == "claude":
        url, headers = "https://api.anthropic.com/v1/models", {"x-api-key": key, "anthropic-version": "2023-06-01"}
    elif pid == "openai":
        url, headers = "https://api.openai.com/v1/models", {"Authorization": f"Bearer {key}"}
    elif pid == "groq":
        url, headers = "https://api.groq.com/openai/v1/models", {"Authorization": f"Bearer {key}"}
    else:
        if not base:
            raise HTTPException(status_code=400, detail="Set the base URL for your OpenAI-compatible endpoint first")
        url, headers = f"{base}/models", {"Authorization": f"Bearer {key}"}
    headers["User-Agent"] = USER_AGENT
    started = time.perf_counter()
    ok, message = False, ""
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=10) as response:
            ok = 200 <= response.status < 300
            message = "Key accepted" if ok else f"Provider returned HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        message = f"Key rejected (HTTP {exc.code})" if exc.code in (401, 403) else f"Provider returned HTTP {exc.code}"
    except OSError as exc:
        message = f"Couldn't reach provider: {getattr(exc, 'reason', exc)}"
    latency = int((time.perf_counter() - started) * 1000)
    with LOCK:
        p.update(status="connected" if ok else "error", lastTestedAt=now(), lastTestMessage=message,
                 lastLatencyMs=latency)
        return {"ok": ok, "message": message, "latencyMs": latency, "provider": provider_public(pid)}


@app.get("/api/routing")
def get_routing() -> dict:
    with LOCK:
        return routing_public()


@app.put("/api/routing")
def save_routing(body: RoutingBody) -> dict:
    with LOCK:
        if body.priority is not None and body.priority != DB["routing"]["priority"]:
            apply_preset(body.priority)
        if body.autoFallback is not None:
            DB["routing"]["autoFallback"] = body.autoFallback
        if body.allowOverride is not None:
            DB["routing"]["allowOverride"] = body.allowOverride
        for rule in body.rules or []:
            if rule.task not in TASKS:
                raise HTTPException(status_code=422, detail=f"Unknown task {rule.task}")
            if rule.fallback == rule.primary:
                raise HTTPException(status_code=422, detail="Fallback must differ from the primary provider")
            current = DB["routing"]["rules"][rule.task]
            if (current["primary"], current["fallback"]) != (rule.primary, rule.fallback):
                DB["routing"]["rules"][rule.task] = {"primary": rule.primary, "fallback": rule.fallback,
                                                     "reason": "Custom rule set by your team"}
        return routing_public()


@app.get("/api/usage")
def get_usage(days: int = Query(14, ge=1, le=90)) -> dict:
    with LOCK:
        start = local_date(now()) - timedelta(days=days - 1)
        tasks = [t for t in DB["tasks"] if local_date(t["at"]) >= start]
        daily = []
        for offset in range(days):
            day = start + timedelta(days=offset)
            day_tasks = [t for t in tasks if local_date(t["at"]) == day]
            by_provider = {pid: round(sum(t["costUsd"] for t in day_tasks if t["provider"] == pid), 6)
                           for pid in PROVIDER_IDS}
            daily.append({"date": day.isoformat(), "costUsd": round(sum(by_provider.values()), 6),
                          "byProvider": by_provider, "calls": len(day_tasks)})
        by_provider = []
        for pid in PROVIDER_IDS:
            pts = [t for t in tasks if t["provider"] == pid]
            latencies = [t["latencyMs"] for t in pts]
            by_provider.append({"provider": pid, "costUsd": round(sum(t["costUsd"] for t in pts), 6), "calls": len(pts),
                                "inputTokens": sum(t["inputTokens"] for t in pts),
                                "outputTokens": sum(t["outputTokens"] for t in pts),
                                "avgLatencyMs": int(sum(latencies) / len(latencies)) if latencies else None,
                                "fallbacks": sum(1 for t in pts if t["status"] == "fallback")})
        by_task = []
        for task, meta in TASKS.items():
            tts = [t for t in tasks if t["task"] == task]
            if tts:
                by_task.append({"task": task, "label": meta["label"], "calls": len(tts),
                                "costUsd": round(sum(t["costUsd"] for t in tts), 6)})
        return {
            "days": days, "daily": daily, "byProvider": by_provider,
            "byTask": sorted(by_task, key=lambda t: -t["costUsd"]),
            "totals": {"costUsd": round(sum(t["costUsd"] for t in tasks), 6), "calls": len(tasks),
                       "tokens": sum(t["inputTokens"] + t["outputTokens"] for t in tasks),
                       "fallbacks": sum(1 for t in tasks if t["status"] == "fallback"),
                       "demoCalls": sum(1 for t in tasks if t["provider"] == "demo")},
        }


@app.get("/api/tasks")
def list_tasks(limit: int = Query(100, ge=1, le=500), provider: Optional[str] = None) -> list[dict]:
    with LOCK:
        tasks = [t for t in reversed(DB["tasks"]) if not provider or t["provider"] == provider][:limit]
        return [{**t, "label": TASKS[t["task"]]["label"]} for t in tasks]


@app.put("/api/settings")
def save_settings(body: SettingsBody) -> dict:
    with LOCK:
        team, settings = DB["team"], DB["settings"]
        if body.teamName is not None:
            team["name"] = body.teamName.strip()
        if body.projectName is not None:
            team["projectName"] = body.projectName.strip()
        if body.projectEndDate is not None:
            if body.projectEndDate:
                try:
                    date.fromisoformat(body.projectEndDate)
                except ValueError as exc:
                    raise HTTPException(status_code=422, detail="Project end date must be YYYY-MM-DD") from exc
            team["projectEndDate"] = body.projectEndDate or None
        for field in ("monthlyBudgetUsd", "alertThreshold", "maxPapers", "backgroundWatch", "groqFreeTier"):
            value = getattr(body, field)
            if value is not None:
                settings[field] = value
        return workspace_public()


@app.post("/api/members", status_code=201)
def add_member(body: MemberBody) -> dict:
    with LOCK:
        email = body.email.strip().lower()
        if any(m["email"].lower() == email for m in DB["members"].values()):
            raise HTTPException(status_code=409, detail="That email is already on the team")
        mid = new_id("m")
        DB["members"][mid] = {"id": mid, "name": body.name.strip(), "email": email, "role": body.role,
                              "joinedAt": now()}
        log_activity("member_added", f"added {body.name.strip()} as {body.role}", actor=CURRENT_USER)
        return member_public(DB["members"][mid])


@app.patch("/api/members/{mid}")
def update_member(mid: str, body: MemberPatch) -> dict:
    with LOCK:
        m = get_or_404("members", mid, "Member")
        m["role"] = body.role
        return member_public(m)


@app.delete("/api/members/{mid}", status_code=204)
def remove_member(mid: str) -> None:
    with LOCK:
        get_or_404("members", mid, "Member")
        if mid == CURRENT_USER:
            raise HTTPException(status_code=409, detail="You can't remove yourself")
        del DB["members"][mid]


@app.get("/api/search")
def search(q: str = Query("", max_length=200)) -> list[dict]:
    needle = q.strip().lower()
    if len(needle) < 2:
        return []
    with LOCK:
        results: list[dict] = []

        def add(kind: str, items, title_of, subtitle_of) -> None:
            hits = [i for i in items if needle in title_of(i).lower()][:5]
            results.extend({"type": kind, "id": i["id"], "title": title_of(i), "subtitle": subtitle_of(i)} for i in hits)

        add("question", DB["questions"].values(), lambda i: i["question"], lambda i: question_status(i).replace("_", " "))
        add("belief", DB["beliefs"].values(), lambda i: i["statement"],
            lambda i: f"{i['status']} · {round(i['confidence'] * 100)}%")
        add("paper", DB["papers"].values(), lambda i: i["title"], lambda i: f"{i['authors'][0] if i['authors'] else ''} · {i['year']}")
        add("dead_end", DB["dead_ends"].values(), lambda i: i["title"], lambda i: i["status"])
        add("meeting", DB["meetings"].values(), lambda i: i["title"], lambda i: i["date"])
        return results


with LOCK:
    seed()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.getenv("PORT", "8001")))
