# resAIDserch - System Architecture

## 1. High-Level Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         resAIDserch                              │
│           Autonomous Literature Research Agent                  │
└─────────────────────────────────────────────────────────────────┘

┌──────────────────┐         ┌──────────────────┐      ┌────────────┐
│   Frontend       │         │    Backend       │      │  Database  │
│  (React/Vite)    │◄───────►│  (FastAPI)       │◄───►│  AlloyDB   │
│  Vercel Deploy   │  HTTPS  │ Cloud Run Deploy │     │ PostgreSQL │
│  - Overview      │         │ - 7-Step Pipeline│     │            │
│  - Research      │         │ - AI Providers   │     │  Teams     │
│  - Beliefs       │         │ - Paper Search   │     │  Questions │
│  - Dead Ends     │         │ - User Mgmt      │     │  Papers    │
│  - Library       │         │ - Task Logs      │     │  Beliefs   │
│  - Meetings      │         │ - Routing Rules  │     │  Dead Ends │
│  - Settings      │         │                  │     │  Meetings  │
└──────────────────┘         └──────────────────┘     └────────────┘
        │                            │
        │                            ▼
        │                    ┌─────────────────┐
        │                    │  AI Providers   │
        │                    ├─────────────────┤
        │                    │ - Claude 3.5    │
        │                    │ - GPT-4o         │
        │                    │ - Groq Mixtral  │
        │                    │ - Custom Keys   │
        │                    └─────────────────┘
        │
        └──────────────────────────►┌──────────────┐
                                     │ External APIs│
                                     ├──────────────┤
                                     │ arXiv Search │
                                     │ Scholar API  │
                                     │ Paper Storage│
                                     └──────────────┘
```

---

## 2. Frontend Architecture

### Technology Stack
- **Framework**: React 18.3.1 with TypeScript 5.9
- **Build Tool**: Vite 5.4.21
- **Styling**: CSS Custom Properties (light/dark theme)
- **State Management**: React Query (@tanstack/react-query 5.107.1)
- **Routing**: React Router v6
- **UI Components**: Custom component library with lucide-react icons
- **Deployment**: Vercel

### Directory Structure
```
frontend/
├── src/
│   ├── pages/                    # Page components
│   │   ├── Overview.tsx          # Dashboard with KPIs, activity
│   │   ├── Research.tsx          # Question list with filters
│   │   ├── QuestionDetail.tsx    # Question with pipeline & beliefs
│   │   ├── Beliefs.tsx           # Team beliefs with confidence scores
│   │   ├── DeadEnds.tsx          # Dead end proposals
│   │   ├── Library.tsx           # Paper library & search
│   │   ├── Meetings.tsx          # Meeting transcripts
│   │   ├── MeetingDetail.tsx     # Meeting stance analysis
│   │   ├── Providers.tsx         # AI provider configuration
│   │   └── Settings.tsx          # Team & account settings
│   │
│   ├── components/
│   │   ├── ui/                   # Reusable UI components
│   │   │   ├── Button.tsx, Badge.tsx, Card.tsx
│   │   │   ├── Modal.tsx, Menu.tsx, Field.tsx
│   │   │   ├── Meter.tsx, StatusBadges.tsx
│   │   │   └── PageHeader.tsx, States.tsx
│   │   │
│   │   ├── layout/               # Layout components
│   │   │   ├── AppShell.tsx      # Main app wrapper with nav
│   │   │   ├── Sidebar.tsx       # Left sidebar navigation
│   │   │   ├── Topbar.tsx        # Top navigation bar
│   │   │   ├── CommandPalette.tsx # Ctrl+K search
│   │   │   └── Logo.tsx
│   │   │
│   │   ├── research/             # Research-specific
│   │   │   ├── Pipeline.tsx      # 7-step visualization
│   │   │   ├── AskQuestionModal.tsx
│   │   │   └── RichText.tsx
│   │   │
│   │   ├── charts/               # Data visualizations
│   │   │   ├── ColumnChart.tsx
│   │   │   ├── Sparkline.tsx
│   │   │   └── SpendBreakdown.tsx
│   │   │
│   │   └── ActivityFeed.tsx      # Activity log component
│   │
│   ├── api/
│   │   ├── client.ts             # Fetch wrapper, endpoints
│   │   ├── hooks.ts              # useQuery/useMutation wrappers
│   │   └── types.ts              # TypeScript types from backend
│   │
│   ├── lib/
│   │   ├── format.ts             # Formatters (USD, dates, etc)
│   │   ├── theme.tsx             # Light/dark theme context
│   │   ├── hooks.ts              # Custom hooks (useDebounced, etc)
│   │   ├── providers.ts          # Provider constants & labels
│   │   └── links.ts              # Route path helpers
│   │
│   ├── styles/
│   │   ├── tokens.css            # Design tokens
│   │   ├── base.css              # Base styles
│   │   ├── layout.css            # Layout utilities
│   │   ├── components.css        # Component styles
│   │   └── pages.css             # Page-specific styles
│   │
│   ├── App.tsx                   # Main router
│   └── main.tsx                  # React entry point
│
└── public/                       # Static assets
    └── index.html
```

### Key Features
- **Polling**: Overview/questions poll every 1.5s while research running
- **Real-time Updates**: Question detail polls at 1s granularity during pipeline
- **Theme**: Light/dark mode with CSS custom properties
- **Responsive**: Mobile-first design (breakpoints: 1180, 1024, 900, 760, 480, 440px)
- **Accessibility**: Semantic HTML, ARIA labels, keyboard navigation

---

## 3. Backend Architecture

### Technology Stack
- **Framework**: FastAPI 0.141.1 (Python async web framework)
- **ORM**: SQLAlchemy 2.0.35
- **Database**: AlloyDB (PostgreSQL-compatible)
- **Driver**: psycopg2-binary 2.9.10
- **Validation**: Pydantic 2.13.4
- **Server**: Uvicorn 0.52.1
- **Deployment**: Google Cloud Run

### API Structure
```
backend/
├── app/
│   ├── main.py                   # FastAPI app initialization
│   │   - Health check endpoint (/health)
│   │   - CORS middleware
│   │   - Lifespan events
│   │
│   ├── models.py                 # SQLAlchemy ORM models
│   │   - Team, User, TeamMember
│   │   - ResearchQuestion, Paper, Belief
│   │   - DeadEnd, Meeting, TaskExecution
│   │   - AIProviderConfig, TaskLog
│   │
│   ├── core/
│   │   ├── database.py           # DB engine & session
│   │   └── config.py             # Settings from env vars
│   │
│   ├── api/                      # API route handlers
│   │   ├── auth.py               # Authentication endpoints
│   │   ├── questions.py          # Question CRUD & pipeline
│   │   ├── beliefs.py            # Belief management
│   │   ├── papers.py             # Paper search & storage
│   │   ├── research.py           # Research task execution
│   │   └── *.py                  # Other endpoints
│   │
│   ├── services/
│   │   ├── ai_providers.py       # Multi-provider router
│   │   │   - Quality prioritization
│   │   │   - Cost tracking
│   │   │   - Auto-retry logic
│   │   │
│   │   └── research_agent.py     # 7-step pipeline
│   │       - Search (arXiv)
│   │       - Extract (quotes from abstracts)
│   │       - Claims (AI analysis)
│   │       - Contradictions (cross-paper)
│   │       - Confidence (supporting papers)
│   │       - Dead ends (unproductive paths)
│   │       - Synthesis (team briefing)
│   │
│   ├── requirements.txt           # Dependencies
│   ├── Dockerfile                # Container image
│   ├── init_db.py                # Database initialization
│   └── cloudbuild.yaml           # Cloud Run CI/CD
│
└── demo_server.py                # Local dev server (in-memory)
```

### API Endpoints (RESTful)
```
Health & Docs
  GET /health                      → {status: "ok"}
  GET /docs                        → Swagger UI
  GET /                            → {service info}

Research Questions
  GET /api/questions               → List questions
  POST /api/questions              → Create question
  GET /api/questions/:id           → Question detail
  POST /api/questions/:id/run      → Start pipeline
  GET /api/questions/:id/tasks     → Task history

Beliefs
  GET /api/beliefs                 → List beliefs
  POST /api/beliefs/:id/approve    → Approve belief
  POST /api/beliefs/:id/reject     → Reject belief

Papers
  GET /api/papers/search           → Search arXiv
  POST /api/papers                 → Add paper
  GET /api/papers/:id              → Paper detail

Providers
  GET /api/providers/config        → Current routing
  POST /api/providers/test         → Test provider key

Usage & Logs
  GET /api/usage                   → Usage stats
  GET /api/logs                    → Task logs
```

---

## 4. Database Schema

### Core Tables

#### Team
```sql
- id (UUID primary key)
- name (string)
- project_name (string, optional)
- project_end_date (datetime, optional) -- Data retention cutoff
- created_at, updated_at (timestamps)
```

#### User
```sql
- id (UUID primary key)
- email (unique, indexed)
- password_hash (bcrypt)
- full_name (string)
- created_at, updated_at
```

#### TeamMember
```sql
- id (UUID primary key)
- team_id (FK → Team)
- user_id (FK → User)
- email (string)
- role (enum: researcher, manager, admin)
- joined_at (timestamp)
```

#### ResearchQuestion
```sql
- id (UUID primary key)
- team_id (FK → Team)
- title (string)
- context (text, optional)
- status (enum: draft, running, needs_review, answered, archived)
- created_at, updated_at
- started_at, completed_at (nullable)
```

#### Paper
```sql
- id (UUID primary key)
- team_id (FK → Team)
- arxiv_id (string, indexed)
- title (string)
- authors (array of strings)
- abstract (text)
- published_date (date)
- url (string)
- added_at (timestamp)
```

#### Belief
```sql
- id (UUID primary key)
- team_id (FK → Team)
- question_id (FK → ResearchQuestion)
- statement (text)
- confidence (float 0-1)
- supporting_papers (array of Paper IDs)
- status (enum: draft, approved, rejected)
- created_at, updated_at, approved_at
```

#### DeadEnd
```sql
- id (UUID primary key)
- team_id (FK → Team)
- question_id (FK → ResearchQuestion)
- description (text)
- reason (text)
- status (enum: proposed, confirmed, dismissed)
- created_at, updated_at
```

#### TaskExecution
```sql
- id (UUID primary key)
- team_id (FK → Team)
- question_id (FK → ResearchQuestion)
- step (enum: search, extract, claims, contradictions, confidence, dead_ends, synthesis)
- provider_used (enum: claude, openai, groq, custom)
- status (enum: pending, running, complete, failed)
- result (JSON)
- cost_usd (decimal)
- started_at, completed_at (timestamps)
```

#### AIProviderConfig
```sql
- id (UUID primary key)
- team_id (FK → Team)
- provider (enum: claude, openai, groq)
- api_key_hint (string, last 4 chars only)
- priority (int, lower = higher priority)
- is_active (boolean)
- created_at, updated_at
```

---

## 5. Data Flow Diagrams

### Question-to-Belief Flow
```
User asks question
        ↓
Question saved (status: draft)
        ↓
User clicks "Run Research"
        ↓
Status → running
        ↓
┌─────────────────────────────────────────────┐
│       7-Step Pipeline Execution             │
├─────────────────────────────────────────────┤
│ 1. Search: Query arXiv (OpenAI/GPT)        │
│    → Get 50 papers matching topic          │
│                                             │
│ 2. Extract: Pull exact quotes (Claude)     │
│    → Verbatim abstracts + key findings     │
│                                             │
│ 3. Claims: Analyze findings (Claude)       │
│    → Extract main claims from papers       │
│                                             │
│ 4. Contradictions: Cross-paper (Groq)      │
│    → Find where papers disagree            │
│                                             │
│ 5. Confidence: Score supporting (OpenAI)   │
│    → How many papers support each claim    │
│                                             │
│ 6. Dead Ends: Find failures (Claude)       │
│    → Approaches that don't work           │
│                                             │
│ 7. Synthesis: Team briefing (Claude)       │
│    → Summary of findings & beliefs        │
└─────────────────────────────────────────────┘
        ↓
Status → needs_review
        ↓
Team reviews results
        ↓
Team approves → Draft Belief created
        ↓
Status → answered + Belief saved
        ↓
Dashboard shows in "Team Beliefs"
```

### Multi-Provider Routing
```
Task needs execution
        ↓
AI Provider Router
        ↓
┌──────────────────────────────────────────┐
│ Priority Queue (quality first)           │
├──────────────────────────────────────────┤
│ 1. Claude 3.5 Sonnet (best quality)      │
│    - $5/1M in, $25/1M out                │
│    - Used for: claims, synthesis         │
│                                          │
│ 2. GPT-4o (high context)                 │
│    - $1.25/1M in, $10/1M out             │
│    - Used for: analysis, routing         │
│                                          │
│ 3. Groq Mixtral (speed)                  │
│    - FREE (limited RPS)                  │
│    - Used for: contradictions, labels    │
│                                          │
│ 4. Custom keys (fallback)                │
│    - User-provided keys                  │
│    - Used for: any task                  │
└──────────────────────────────────────────┘
        ↓
Try Provider 1
    ✓ Success → return result
    ✗ Rate limit/error → try Provider 2
        ...
```

---

## 6. Deployment Architecture (Google Cloud)

```
┌─────────────────────────────────────────────────────────────────┐
│                    resAIDserch Deployment                        │
└─────────────────────────────────────────────────────────────────┘

GitHub Repository (biggudawgg/resAIDserch)
        │
        ▼
┌────────────────────────┐
│   Google Cloud Build   │  (cloudbuild.yaml)
│  ├─ Checkout code     │
│  ├─ Install deps      │
│  ├─ Build Docker img  │
│  └─ Push to GCR       │
└────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────┐
│     Container Registry (GCR)               │
│  gcr.io/resaiderch/resaiderch-backend:... │
└────────────────────────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────┐
│      Google Cloud Run                      │
│  ├─ Service: lit-scout-backend             │
│  ├─ CPU: 2 cores                           │
│  ├─ Memory: 2GB                            │
│  ├─ Timeout: 900s                          │
│  └─ Cloud SQL Proxy → AlloyDB              │
└────────────────────────────────────────────┘
        │
        ├──────────────┐
        │              │
        ▼              ▼
┌──────────────────────────────────────────┐
│        AlloyDB Cluster                   │
│  ├─ Instance: lit-scout-primary          │
│  ├─ Database: lit_scout                  │
│  ├─ Private VPC peering                  │
│  └─ Automated backups (daily)            │
└──────────────────────────────────────────┘

───────────────────────────────────────────

GitHub Repository
        │
        ▼
┌────────────────────────┐
│   Vercel CI/CD         │
│  ├─ Checkout code      │
│  ├─ npm install        │
│  ├─ npm run build      │
│  └─ Deploy to Vercel   │
└────────────────────────┘
        │
        ▼
┌────────────────────────────────────────────┐
│     Vercel Edge Network                    │
│  URL: resaiderch.vercel.app               │
│  ├─ Cached globally                        │
│  ├─ Auto-scaling                           │
│  └─ VITE_API_URL → Cloud Run API           │
└────────────────────────────────────────────┘
```

---

## 7. Security Model

### Authentication & Authorization
- **API Keys**: Stored in Google Secret Manager (never in .env files)
- **User Sessions**: JWT tokens (HS256, 24-hour expiry)
- **CORS**: Restricted to deployed frontend domain only
- **Database**: Private VPC, Cloud SQL Proxy tunnel only

### Data Protection
- **Encryption in transit**: HTTPS only (Cloud Run + Vercel)
- **Encryption at rest**: AlloyDB encryption (default)
- **Secret Manager**: All API keys encrypted
- **Data Retention**: Automatic deletion at project_end_date + 3 months

### Audit & Logging
- **Cloud Run Logs**: All API requests logged (CloudLogging)
- **Task Logs**: Every AI task execution logged with cost
- **Activity Feed**: User-facing activity history
- **Error Tracking**: Can integrate Sentry

---

## 8. Scaling & Performance

### Frontend
- **CDN**: Vercel global edge network
- **Build size**: ~350KB JS (106KB gzipped)
- **First paint**: < 1s (global average)

### Backend
- **Cloud Run auto-scaling**: 0 → 100 instances
- **Concurrent requests**: Limited by CPU (default 2 → ~50 req/s)
- **Database connections**: AlloyDB connection pooling
- **API response time**: < 500ms (avg)

### Database
- **AlloyDB**: High availability, auto-scaling storage
- **Read replicas**: Can add for reporting
- **Backups**: Automated daily + on-demand

---

## 9. Monitoring & Observability

### Metrics to Track
- API response times (percentiles: p50, p95, p99)
- Error rates by endpoint
- Task execution costs (per provider)
- Database query performance
- Frontend performance (Web Vitals)

### Alerts
- Cloud Run errors > 1% rate
- Task completion time > 5min
- Database replication lag > 60s
- Vercel deployment failures

### Dashboards
- Cloud Monitoring dashboard (GCP Console)
- Vercel Analytics (vercel.com)
- Custom cost tracking dashboard

---

## 10. Development & Testing

### Local Development
```bash
# Backend (demo mode, in-memory)
cd backend
python demo_server.py  # Port 8001

# Frontend (Vite dev server)
cd frontend
npm run dev  # Port 5173, proxies /api to backend

# Or Docker Compose
docker-compose up  # Full stack with Postgres
```

### Testing Strategy
- **Backend**: pytest (unit + integration tests)
- **Frontend**: Jest + React Testing Library
- **E2E**: Playwright
- **API Smoke Tests**: Manual curl or Postman

### Code Quality
- **Linting**: ESLint (frontend), flake8 (backend)
- **Type checking**: TypeScript (frontend), mypy (backend)
- **Formatting**: Prettier (frontend), Black (backend)

---

## 11. Future Extensions

### Potential Features
- Real-time WebSocket updates (instead of polling)
- Multi-team collaboration & workspaces
- Custom research agents (user-defined steps)
- Browser extension for paper management
- Slack/Teams integration for notifications
- GraphQL API (alternative to REST)
- Mobile app (React Native)

### Infrastructure Improvements
- Database read replicas for analytics
- Redis caching layer
- Message queue (Pub/Sub) for async tasks
- Vector database for semantic search
- Distributed task queue (Cloud Tasks)

---

**Last Updated:** 2026-11-07  
**Architecture Version:** 1.0  
**Deployment Target:** Google Cloud + Vercel
