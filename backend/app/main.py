from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, Session
import os
from dotenv import load_dotenv

from app.models import Base
from app.services.ai_providers import AIProviderRouter
from app.api import auth, questions, papers, beliefs, research

load_dotenv()

# Database
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/lit-scout")
engine = create_engine(DATABASE_URL, echo=False)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Create tables
Base.metadata.create_all(bind=engine)


# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# AI Provider Router
ai_router = AIProviderRouter(
    claude_api_key=os.getenv("ANTHROPIC_API_KEY"),
    groq_api_key=os.getenv("GROQ_API_KEY"),
    openai_api_key=os.getenv("OPENAI_API_KEY"),
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    print("🚀 Lit Scout API starting...")
    print("✓ Database connected")
    print("✓ AI providers initialized")
    yield
    print("🛑 Shutting down...")


app = FastAPI(
    title="Technical Literature Scout API",
    description="Autonomous AI research agent for engineering teams",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS - configured via environment variable for production
cors_origins = os.getenv("CORS_ORIGINS", "*").split(",")
cors_origins = [origin.strip() for origin in cors_origins]

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(questions.router, prefix="/api/questions", tags=["questions"])
app.include_router(papers.router, prefix="/api/papers", tags=["papers"])
app.include_router(beliefs.router, prefix="/api/beliefs", tags=["beliefs"])
app.include_router(research.router, prefix="/api/research", tags=["research"])


@app.get("/health")
async def health_check():
    return {"status": "ok", "service": "lit-scout-api"}


@app.get("/")
async def root():
    return {
        "service": "Technical Literature Scout API",
        "version": "0.1.0",
        "docs": "/docs",
    }
