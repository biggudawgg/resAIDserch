# resAIDserch - Architecture in plain English

**What it is:** a research assistant for a small engineering team. You ask a technical question, an AI agent reads papers and drafts an answer, and your team approves what goes into shared memory.

## The big picture

```
   Browser                     Backend API                  Storage
 ┌───────────┐   /api/...   ┌──────────────┐   SQL    ┌──────────────┐
 │ React app │ ───────────► │   FastAPI    │ ───────► │  Database    │
 │ (Vercel)  │ ◄─────────── │ (Cloud Run)  │          │ (AlloyDB)    │
 └───────────┘     JSON     └──────┬───────┘          └──────────────┘
                                   │
                    ┌──────────────┼───────────────┐
                    ▼              ▼               ▼
                 arXiv        AI providers     (later) PDFs
              (find papers)  Claude/OpenAI/Groq
```

Three parts, each does one job:

| Part | Where in the repo | Job |
|---|---|---|
| Frontend | `frontend/` | The screens you click on |
| Backend | `backend/` | Runs the research steps, talks to AI and arXiv |
| Database | AlloyDB (Postgres) | Remembers questions, beliefs, papers, costs |

## What happens when you ask a question

```
Ask question
   │
   ▼
1 Search      find papers on arXiv
2 Extract     copy exact quotes from them
3 Claims      what does each paper say?
4 Conflicts   where do papers disagree?
5 Confidence  how strong is the evidence?
6 Dead ends   what approaches look like they fail?
7 Briefing    write a short summary + a draft belief
   │
   ▼
A human reads it and clicks Approve / Edit / Reject
   │
   ▼
Approved beliefs become team memory
```

Nothing enters team memory without a person approving it. Each step can use a different AI provider; the app picks the best one for the task (quality first, cost second) and retries on the next if one fails.

## The screens

| Screen | What it is for | Picture |
|---|---|---|
| Overview | What needs your attention, spend, recent activity | [pics/01-overview.png](pics/01-overview.png) |
| Research | All questions and their status | [pics/02-research.png](pics/02-research.png) |
| Question page | The pipeline, evidence, draft belief to approve | [pics/03-question-needs-review.png](pics/03-question-needs-review.png) |
| Beliefs | What the team currently believes, with confidence | [pics/05-beliefs.png](pics/05-beliefs.png) |
| Dead ends | Approaches the team ruled out, and why | [pics/06-dead-ends.png](pics/06-dead-ends.png) |
| Library | Papers collected so far | [pics/07-library.png](pics/07-library.png) |
| Meetings | Who said what in a meeting transcript | [pics/10-meeting-stances.png](pics/10-meeting-stances.png) |
| Providers & usage | Which AI did what, and what it cost | [pics/11-providers.png](pics/11-providers.png) |
| Settings | Members, API keys, budget | [pics/12-settings-members.png](pics/12-settings-members.png) |

Light, dark and phone versions are all in [pics/](pics/).

## The backend, and what is real

`backend/demo_server.py` is the API the screens use (about 39 endpoints). It is what the container runs.

- **Saved data:** with `HINDSIGHT_DATABASE_URL` set (AlloyDB / Postgres) the whole workspace is saved to the database after every change and reloaded on start. Without it, data lives in memory only.
- **Real:** paper search (live arXiv), exact quotes from abstracts, adding papers by arXiv ID, provider key tests, routing rules, budgets, members.
- **Not real yet:** the AI steps (claims, conflicts, confidence, dead ends, briefing) are labelled heuristics; calling the models themselves is not wired in.
- **One instance only:** state is held in the process, so Cloud Run is set to exactly one always-on instance.

`backend/app/` is an older, separate API with its own routes (`/api/questions/teams/{id}/...`). The screens do not use it.

## Where it runs

```
GitHub ──► Cloud Build ──► Cloud Run (backend) ──► AlloyDB
   │
   └─────► Vercel (frontend) ── /api ──► Cloud Run
```

- The frontend reads `VITE_API_URL` (must end in `/api`). Locally it is unset and Vite proxies `/api` to the backend.
- Secrets (API keys, database URL) live in Google Secret Manager, never in git.
- Deploy steps: [DEPLOYMENT.md](DEPLOYMENT.md).

## Folder map

```
frontend/src/pages/        one file per screen
frontend/src/api/          typed calls to the backend
frontend/src/components/   buttons, cards, charts, layout
backend/demo_server.py     demo API (in-memory)
backend/app/               real API (Postgres)
backend/app/services/      AI providers + research steps
infrastructure/            AlloyDB setup script
pics/                      screenshots of the real app
```
