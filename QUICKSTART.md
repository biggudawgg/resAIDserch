# Quick Start Guide - Lit Scout Backend & Frontend

## Run it now (demo mode, no database or API keys)

Two terminals:

```powershell
# Terminal 1: demo API on http://127.0.0.1:8001 (docs at /docs)
cd backend
pip install fastapi uvicorn
python demo_server.py
```

```powershell
# Terminal 2: the app on http://localhost:5173
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173**.

What is real and what is simulated in demo mode:

- **Real:** paper search (live arXiv API), claims quoted verbatim from abstracts, adding papers by arXiv ID,
  API-key connection tests, routing rules, budgets, members, and the meeting stance extraction workflow.
- **Simulated:** the LLM steps (claims, contradictions, confidence, dead ends, briefing) run as labelled
  heuristics. The seeded workspace (team, past runs, usage history) is sample data.
- Data lives in memory and resets when `demo_server.py` restarts.

The demo API uses port 8001 so it doesn't collide with anything already on 8000. The Vite dev server
proxies `/api` to it (see `frontend/vite.config.ts`).

---

## 🏃 How to Run (Choice 1: Docker Compose - Easiest)

### Prerequisites
- Docker & Docker Compose installed
- API keys: `ANTHROPIC_API_KEY`, `GROQ_API_KEY`

### Steps

```bash
# 1. Navigate to project root
cd c:/Users/vivek/Downloads/lit-scout

# 2. Create .env file with your API keys
cp backend/.env.example backend/.env

# Then edit backend/.env:
# ANTHROPIC_API_KEY=sk-ant-...
# GROQ_API_KEY=gsk-...
# OPENAI_API_KEY=sk-...  (optional)

# 3. Start everything with Docker Compose
docker-compose up

# Then visit:
# Frontend: http://localhost:5173
# Backend:  http://localhost:8000/docs
```

---

## 🏃 How to Run (Choice 2: Manual - For Development)

### Backend Setup

```bash
# 1. Navigate to backend
cd c:/Users/vivek/Downloads/lit-scout/backend

# 2. Create virtual environment
python -m venv venv
source venv/Scripts/activate  # Windows: venv\Scripts\activate.bat

# 3. Install dependencies
pip install -r requirements.txt

# 4. Create .env file
cp .env.example .env
# Edit .env with your API keys

# 5. Start FastAPI server
python -m uvicorn app.main:app --reload

# Server runs on http://127.0.0.1:8000
# API docs: http://127.0.0.1:8000/docs
```

### Frontend Setup (in another terminal)

```bash
# 1. Navigate to frontend
cd c:/Users/vivek/Downloads/lit-scout/frontend

# 2. Install dependencies
npm install

# 3. Start dev server
npm run dev

# Frontend runs on http://localhost:5173
# API calls proxy to http://localhost:8000
```

---

## 📋 Backend API Endpoints

Once backend is running, you can test these:

```bash
# Health check
curl http://localhost:8000/health

# Root endpoint
curl http://localhost:8000/

# API docs (interactive)
curl http://localhost:8000/docs
```

---

## 🐛 Known Issues Fixed

- ✅ Fixed SQLAlchemy `metadata` field conflict (renamed to `paper_metadata`, `meeting_metadata`, `task_result`)
- ✅ Fixed PyJWT version compatibility (2.8.1 → 2.15.1)

---

## 📁 Project Structure

```
lit-scout/
├── backend/                    # NEW: FastAPI backend
│   ├── app/
│   │   ├── main.py            # FastAPI app
│   │   ├── models.py          # Database models
│   │   ├── api/               # API routes
│   │   ├── services/          # AI providers + research agent
│   │   └── core/              # Database config
│   ├── requirements.txt        # Python dependencies
│   ├── Dockerfile
│   └── .env.example
│
├── frontend/                   # NEW: React frontend
│   ├── src/
│   │   ├── pages/             # 4 full pages
│   │   ├── components/ui/     # Reusable components
│   │   ├── services/          # API client
│   │   ├── types/             # TypeScript definitions
│   │   └── theme.ts           # Design system
│   ├── package.json
│   ├── vite.config.ts
│   └── tsconfig.json
│
├── docker-compose.yml         # Local dev stack
├── .gitignore
├── README.md                  # Full documentation
├── PHASE2_SUMMARY.md         # UI/frontend details
└── IMPLEMENTATION_STATUS.md   # Complete status
```

---

## 🔑 Environment Variables

### Backend (.env)

```ini
# Database
DATABASE_URL=postgresql://user:password@localhost/lit_scout

# AI Providers
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GROQ_API_KEY=gsk-...

# JWT
JWT_SECRET=your-secret-key
JWT_ALGORITHM=HS256

# Server
ENVIRONMENT=development
```

### Frontend (.env - optional)

```ini
VITE_API_URL=http://localhost:8000/api
VITE_ENVIRONMENT=development
```

---

## 📚 Key Features Implemented

### Backend
- ✅ 7-step autonomous research pipeline
- ✅ Multi-provider AI adapter (Claude, GPT, Groq)
- ✅ 10 database models
- ✅ Full CRUD for research questions
- ✅ Task execution logging
- ✅ Cost tracking per provider

### Frontend
- ✅ Dashboard (active questions, beliefs, usage)
- ✅ Team Beliefs (confidence bars, timeline)
- ✅ Research Findings (AI results, contradictions)
- ✅ Settings (API keys, team management)
- ✅ Beautiful design system
- ✅ TypeScript type safety

---

## 🚀 Production Deployment

Ready to deploy to Google Cloud and Vercel? See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for complete step-by-step instructions including:

- Setting up AlloyDB database on Google Cloud
- Deploying backend to Cloud Run
- Deploying frontend to Vercel
- Configuration and troubleshooting

**TL;DR:**
```bash
# 1. Set up database
./infrastructure/alloydb-setup.sh YOUR_PROJECT_ID us-central1

# 2. Deploy backend
gcloud run deploy lit-scout-backend --image gcr.io/YOUR_PROJECT_ID/lit-scout-backend

# 3. Deploy frontend
vercel --prod
```

## 🎯 What's Next (Phase 3+)

After deploying to production:

1. **Add Interactive Features**
   - Meeting upload & transcription
   - Real-time task tracking
   - Export to Google Docs

2. **Testing**
   - Backend tests (pytest)
   - Frontend tests (Jest)
   - E2E tests (Playwright)

3. **Monitoring**
   - Set up Cloud Monitoring alerts
   - Configure error tracking (Sentry)
   - Dashboard for usage analytics

---

## 🆘 Troubleshooting

### Port Already in Use
```bash
# If port 8000 is taken by old app:
# Option 1: Stop old app and use 8000
# Option 2: Run on different port:
python -m uvicorn app.main:app --port 8001
```

### Dependencies Not Installing
```bash
# Try updating pip first
python -m pip install --upgrade pip

# Then install requirements
pip install -r requirements.txt
```

### Database Connection Error
```bash
# Make sure DATABASE_URL is set correctly in .env
# For local dev, PostgreSQL should be running
# (Docker Compose handles this automatically)
```

### Frontend Can't Reach Backend
```bash
# Make sure backend is running on http://localhost:8000
# Check frontend .env has correct VITE_API_URL
# Check CORS is enabled in backend
```

---

## 📖 Documentation

- **README.md** - Full project documentation
- **PHASE2_SUMMARY.md** - UI/Design system details
- **IMPLEMENTATION_STATUS.md** - Complete implementation report

---

## 💡 Tips

- Use Docker Compose for easiest setup
- Check backend API docs at http://localhost:8000/docs (FastAPI auto-generates Swagger UI)
- Frontend hot-reloads on save (npm run dev)
- Backend hot-reloads with --reload flag
- Check console for detailed error messages

---

**Ready? Start with Docker Compose!** 🐳

```bash
docker-compose up
```

Then visit:
- Frontend: http://localhost:5173
- Backend API: http://localhost:8000/docs
