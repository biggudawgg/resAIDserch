# Technical Literature Scout (Hindsight)

🔬 **Autonomous AI Research Agent for Engineering Teams**

An intelligent research tool that automatically searches papers, analyzes them, synthesizes findings, and remembers every decision your team makes.

## 🚀 Features

### Core
- **Autonomous Research Agent**: Posts a question → AI automatically searches arXiv/Scholar, analyzes 50+ papers
- **7-Step Research Pipeline**: Search → Extract → Analyze → Contradiction Detection → Confidence Scoring → Dead Ends → Synthesis
- **Multi-AI Provider**: Groq for speed, Claude for quality reasoning, OpenAI as fallback
- **Real-Time Usage Tracking**: Know which provider handled each task and costs

### Team Collaboration
- **Human-in-the-Loop**: Team reviews and approves all agent findings
- **Meeting Stances**: Upload recordings, extract team agreements/disagreements
- **Team Memory**: Remember beliefs, dead ends, contradictions, and decisions

### Intelligence
- **Contradiction Detection**: Find where papers disagree with each other
- **Confidence Scoring**: Auto-calculate confidence based on supporting papers
- **Dead End Proposals**: Identify when approaches fundamentally fail
- **Weekly Digest**: What changed in team's understanding

## 🏗️ Architecture

### Backend
- **Framework**: FastAPI (Python 3.11+)
- **Database**: AlloyDB (PostgreSQL-compatible, on Google Cloud)
- **AI**: Claude (Opus 5.5), OpenAI GPT-4, Groq (free tier)
- **Deployment**: Google Cloud Run (serverless, auto-scaling)

### Frontend
- **Framework**: React 18 + TypeScript
- **State**: TanStack Query + Zustand
- **Styling**: Tailwind CSS
- **Deployment**: Vercel

### Data
- **Storage**: Google Cloud Storage (PDFs, recordings)
- **Database**: AlloyDB with pgvector support

## 🏃 Quick Start

### Prerequisites
- Docker & Docker Compose
- Python 3.11+ (for local dev)
- Node.js 20+ (for frontend dev)
- API keys: Anthropic, Groq (optional), OpenAI (optional)

### Local Development

1. **Clone & Setup**
```bash
git clone <repo>
cd lit-scout
cp backend/.env.example backend/.env
```

2. **Set API Keys**
```bash
# backend/.env
ANTHROPIC_API_KEY=sk-ant-...
GROQ_API_KEY=gsk-...
OPENAI_API_KEY=sk-...  # optional
```

3. **Start with Docker Compose**
```bash
docker-compose up
```

- Backend: http://localhost:8000 (API docs at /docs)
- Frontend: http://localhost:5173
- Database: postgres://localhost:5432

### Manual Setup (Without Docker)

**Backend:**
```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## 📖 API Routes

### Research Questions
```
POST   /api/questions/teams/{team_id}/questions
GET    /api/questions/teams/{team_id}/questions
GET    /api/questions/teams/{team_id}/questions/{question_id}
PUT    /api/questions/teams/{team_id}/questions/{question_id}
DELETE /api/questions/teams/{team_id}/questions/{question_id}
```

### Trigger Research
```
POST   /api/research/teams/{team_id}/questions/{question_id}/research
GET    /api/research/teams/{team_id}/research/status
```

### Beliefs
```
GET    /api/beliefs/teams/{team_id}/beliefs
POST   /api/beliefs/teams/{team_id}/beliefs
```

## 🔄 Research Pipeline (7 Steps)

1. **Paper Search** (Groq): Query arXiv/Scholar for relevant papers
2. **Fetch & Extract** (Local): Download PDFs, extract text
3. **Claim Extraction** (Claude): Parse each paper, extract key claims
4. **Contradiction Detection** (Claude): Find where papers disagree
5. **Confidence Scoring** (Claude): Rate consensus claim (0-1.0)
6. **Dead End Proposal** (Claude): Identify fundamental limitations
7. **Synthesis & Briefing** (Claude): Generate human-readable report

## 🗄️ Database Schema

**Core Tables:**
- `teams` - Team metadata
- `team_members` - Users in team
- `research_questions` - Active questions
- `papers` - Papers fetched from arXiv/Scholar
- `beliefs` - Team beliefs with confidence
- `dead_ends` - Rejected ideas with reasons
- `meetings` - Team meetings (audio/transcript)
- `meeting_stances` - Who agreed/disagreed
- `task_executions` - AI task history
- `audit_log` - All actions logged

**Retention:** Keep until `project_end_date + 3 months`, then auto-delete (GDPR compliant)

## 🌩️ Deployment (Google Cloud)

### Production Setup
```bash
# 1. Cloud Run
gcloud run deploy lit-scout-api \
  --source ./backend \
  --platform managed \
  --region us-central1

# 2. AlloyDB
gcloud alloydb clusters create lit-scout-prod \
  --region us-central1

# 3. Frontend on Vercel
vercel deploy --prod
```

### Cost Estimation
- AlloyDB HA: ~$0.50/hour (~$360/month)
- Cloud Run: Pay per request (~$50-200/month)
- Cloud Storage: ~$0.02/GB (~$10/month)
- **Total:** ~$420-550/month for small team

## 📊 Usage Tray (UI)

Bottom bar shows in real-time:
```
Current: Groq | Tokens: 1,240 in / 340 out | ~$0.0001 | Session: $0.002
```

## 🔐 Security

- **Auth**: JWT with secure HTTP-only cookies
- **API Keys**: AES-256 encrypted, stored in secrets manager
- **Data**: TLS in transit, encrypted at rest
- **Access**: Role-based (lead, researcher, engineer, viewer)
- **Audit**: All actions logged

## 📝 Implementation Phases

### Phase 1 (Week 1-2): Core Research Agent
- Q tracker, ArXiv search, PDF extraction
- Claim extraction, AI routing, usage tray
- Basic findings dashboard

### Phase 2 (Week 3-4): Intelligence & Loop
- Contradiction detection, dead-end proposals
- Confidence scoring, weekly background watch
- Findings approval workflow

### Phase 3 (Week 5+): Team Collaboration
- Meeting transcription & stance extraction
- Memory timelines, briefing generation
- Exports to Google Docs

## 🚀 Next Steps

1. Set up API keys in `.env`
2. Run `docker-compose up`
3. Visit http://localhost:5173
4. Create a team and post your first research question
5. Watch the AI research 🤖

## 📧 Support

- API Docs: http://localhost:8000/docs
- Issues: GitHub Issues
- Feedback: Email

## 📄 License

MIT

---

**Built with ❤️ for research teams everywhere.**
