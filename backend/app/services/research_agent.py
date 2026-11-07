import asyncio
import json
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, asdict
from datetime import datetime
import arxiv
import httpx
import pdfplumber
from tenacity import retry, stop_after_attempt, wait_exponential

from app.services.ai_providers import AIProviderRouter, AIResponse


@dataclass
class ResearchFinding:
    question_id: str
    task_type: str
    papers_analyzed: int
    key_claims: List[Dict[str, Any]]
    contradictions: List[Dict[str, Any]]
    proposed_belief: Optional[Dict[str, Any]]
    proposed_dead_end: Optional[Dict[str, Any]]
    confidence_score: float
    reasoning: str
    provider_used: str
    execution_time_ms: int


class ResearchAgent:
    """Autonomous research agent that searches and analyzes papers."""

    def __init__(self, ai_router: AIProviderRouter):
        self.ai_router = ai_router
        self.arxiv_client = arxiv.Client()

    async def research_question(
        self,
        question: str,
        context: Optional[str] = None,
        max_papers: int = 50,
    ) -> ResearchFinding:
        """
        Execute full 7-step research pipeline for a question.

        Steps:
        1. Search (Groq - fast)
        2. Fetch & Extract (Local)
        3. Claim Extraction (Claude)
        4. Contradiction Detection (Claude)
        5. Confidence Scoring (Claude)
        6. Dead End Proposal (Claude)
        7. Synthesis & Briefing (Claude)
        """

        start_time = datetime.utcnow()

        # Step 1: Paper Search
        papers = await self._search_papers(question, max_papers)
        if not papers:
            return ResearchFinding(
                question_id="",
                task_type="research_pipeline",
                papers_analyzed=0,
                key_claims=[],
                contradictions=[],
                proposed_belief=None,
                proposed_dead_end=None,
                confidence_score=0.0,
                reasoning="No papers found for this question.",
                provider_used="none",
                execution_time_ms=0,
            )

        # Step 2: Fetch & Extract text from papers
        papers_with_text = await self._fetch_and_extract_papers(papers[:max_papers])

        # Step 3: Extract claims from papers
        all_claims = await self._extract_claims_from_papers(papers_with_text)

        # Step 4: Detect contradictions
        contradictions = await self._detect_contradictions(all_claims)

        # Step 5: Calculate confidence
        consensus_claim, confidence = await self._score_confidence(all_claims, contradictions)

        # Step 6: Propose dead ends
        dead_end = await self._propose_dead_end(all_claims, consensus_claim, contradictions)

        # Step 7: Generate synthesis
        briefing = await self._generate_synthesis(
            question, consensus_claim, all_claims, contradictions, dead_end
        )

        execution_time = int((datetime.utcnow() - start_time).total_seconds() * 1000)

        return ResearchFinding(
            question_id="",
            task_type="research_pipeline",
            papers_analyzed=len(papers_with_text),
            key_claims=all_claims[:10],
            contradictions=contradictions,
            proposed_belief={
                "statement": consensus_claim,
                "confidence": confidence,
                "reasoning": briefing,
            },
            proposed_dead_end=dead_end,
            confidence_score=confidence,
            reasoning=briefing,
            provider_used="multi",
            execution_time_ms=execution_time,
        )

    async def _search_papers(self, query: str, max_papers: int = 50) -> List[Dict]:
        """Step 1: Search arXiv for papers."""
        papers = []

        try:
            # Use Groq for fast ranking if we implement it
            search = arxiv.Search(
                query=query,
                max_results=max_papers,
                sort_by=arxiv.SortCriterion.Relevance,
            )

            for paper in self.arxiv_client.results(search):
                papers.append({
                    "arxiv_id": paper.entry_id.split("/abs/")[-1],
                    "title": paper.title,
                    "authors": [str(author) for author in paper.authors],
                    "published": paper.published.isoformat(),
                    "summary": paper.summary,
                    "pdf_url": paper.pdf_url,
                    "arxiv_url": paper.entry_id,
                })
        except Exception as e:
            print(f"Error searching arXiv: {e}")

        return papers

    @retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=2, max=10))
    async def _fetch_and_extract_papers(self, papers: List[Dict]) -> List[Dict]:
        """Step 2: Fetch PDFs and extract text."""
        papers_with_text = []

        for paper in papers:
            try:
                # Fetch PDF
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.get(paper["pdf_url"])
                    if response.status_code != 200:
                        continue

                    # Extract text
                    text = ""
                    try:
                        with pdfplumber.open(response.content) as pdf:
                            for page in pdf.pages[:10]:  # First 10 pages
                                text += page.extract_text() or ""
                    except Exception:
                        continue

                paper["full_text"] = text[:50000]  # Limit to 50K chars
                papers_with_text.append(paper)

            except Exception as e:
                print(f"Error fetching {paper['title']}: {e}")
                continue

        return papers_with_text

    async def _extract_claims_from_papers(self, papers: List[Dict]) -> List[Dict]:
        """Step 3: Use Claude to extract key claims."""
        all_claims = []

        for paper in papers:
            messages = [
                {
                    "role": "user",
                    "content": f"""Analyze this paper and extract 3-5 key claims/findings:

Title: {paper['title']}

Text (first 10 pages):
{paper['full_text'][:20000]}

Extract claims in JSON format:
{{"claims": [{{"claim": "...", "evidence": "...", "confidence": 0.9}}]}}""",
                }
            ]

            response = await self.ai_router.execute_task(
                task_type="claim_extraction",
                messages=messages,
                max_tokens=1000,
            )

            try:
                claims_data = json.loads(response.content)
                for claim in claims_data.get("claims", []):
                    all_claims.append({
                        "paper_id": paper["arxiv_id"],
                        "paper_title": paper["title"],
                        **claim,
                    })
            except json.JSONDecodeError:
                pass

        return all_claims

    async def _detect_contradictions(self, claims: List[Dict]) -> List[Dict]:
        """Step 4: Use Claude to find contradictions."""
        if len(claims) < 2:
            return []

        contradictions = []
        claims_summary = json.dumps(claims, indent=2)

        messages = [
            {
                "role": "user",
                "content": f"""Find contradictions between these paper claims:

{claims_summary}

Return contradictions in JSON format:
{{"contradictions": [{{"paper_a": "...", "paper_b": "...", "reason": "...", "confidence": 0.8}}]}}""",
            }
        ]

        response = await self.ai_router.execute_task(
            task_type="contradiction_detection",
            messages=messages,
            max_tokens=1500,
        )

        try:
            data = json.loads(response.content)
            contradictions = data.get("contradictions", [])
        except json.JSONDecodeError:
            pass

        return contradictions

    async def _score_confidence(
        self, claims: List[Dict], contradictions: List[Dict]
    ) -> tuple:
        """Step 5: Calculate confidence in consensus claim."""
        claims_summary = json.dumps(claims, indent=2)
        contradictions_summary = json.dumps(contradictions, indent=2)

        messages = [
            {
                "role": "user",
                "content": f"""Based on these claims and contradictions, propose a consensus statement and confidence:

Claims:
{claims_summary}

Contradictions:
{contradictions_summary}

Return in JSON format:
{{"consensus": "...", "confidence": 0.85, "reasoning": "..."}}""",
            }
        ]

        response = await self.ai_router.execute_task(
            task_type="confidence_scoring",
            messages=messages,
            max_tokens=1000,
        )

        try:
            data = json.loads(response.content)
            return data.get("consensus", ""), data.get("confidence", 0.5)
        except json.JSONDecodeError:
            return "", 0.5

    async def _propose_dead_end(
        self, claims: List[Dict], consensus: str, contradictions: List[Dict]
    ) -> Optional[Dict]:
        """Step 6: Propose dead ends based on limitations found."""
        messages = [
            {
                "role": "user",
                "content": f"""Based on the claims, consensus, and contradictions, identify if there are fundamental limitations:

Consensus: {consensus}

Key claims and limitations (sample): {json.dumps(claims[:5], indent=2)}

Contradictions: {json.dumps(contradictions[:3], indent=2)}

If there are fundamental limitations making this approach not work, return:
{{"dead_end": "The approach fails when...", "reason": "Evidence from papers", "conditions": ["condition1", "condition2"]}}

Otherwise return: {{"dead_end": null}}""",
            }
        ]

        response = await self.ai_router.execute_task(
            task_type="dead_end_proposal",
            messages=messages,
            max_tokens=800,
        )

        try:
            data = json.loads(response.content)
            if data.get("dead_end"):
                return data
        except json.JSONDecodeError:
            pass

        return None

    async def _generate_synthesis(
        self,
        question: str,
        consensus: str,
        claims: List[Dict],
        contradictions: List[Dict],
        dead_end: Optional[Dict],
    ) -> str:
        """Step 7: Generate human-readable synthesis."""
        messages = [
            {
                "role": "user",
                "content": f"""Generate a synthesis briefing for a research team:

Question: {question}
Consensus: {consensus}

Supporting claims (sample): {json.dumps(claims[:3], indent=2)}
Contradictions found: {len(contradictions)}
Dead end identified: {dead_end is not None}

Write a 1-2 paragraph summary for the team.""",
            }
        ]

        response = await self.ai_router.execute_task(
            task_type="synthesis_briefing",
            messages=messages,
            max_tokens=1000,
        )

        return response.content
