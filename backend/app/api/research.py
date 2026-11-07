from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
import asyncio

from app.core.database import get_db
from app.models import ResearchQuestion, Belief, DeadEnd, Team, TaskExecution
from app.services.research_agent import ResearchAgent
from app.services.ai_providers import AIProviderRouter
import os
from datetime import datetime

router = APIRouter()

# Initialize AI router
ai_router = AIProviderRouter(
    claude_api_key=os.getenv("ANTHROPIC_API_KEY"),
    groq_api_key=os.getenv("GROQ_API_KEY"),
    openai_api_key=os.getenv("OPENAI_API_KEY"),
)

research_agent = ResearchAgent(ai_router)


class ResearchResponse(BaseModel):
    question_id: str
    papers_analyzed: int
    proposed_belief: Optional[dict]
    proposed_dead_end: Optional[dict]
    confidence_score: float
    reasoning: str
    provider_used: str
    execution_time_ms: int


@router.post("/teams/{team_id}/questions/{question_id}/research", response_model=ResearchResponse)
async def trigger_research(
    team_id: str,
    question_id: str,
    db: Session = Depends(get_db),
):
    """
    Trigger autonomous research for a question.

    Runs the 7-step research pipeline:
    1. Search (Groq - fast)
    2. Fetch & Extract (Local)
    3. Claim Extraction (Claude)
    4. Contradiction Detection (Claude)
    5. Confidence Scoring (Claude)
    6. Dead End Proposal (Claude)
    7. Synthesis & Briefing (Claude)
    """

    # Verify question exists
    question = (
        db.query(ResearchQuestion)
        .filter(
            ResearchQuestion.id == question_id,
            ResearchQuestion.team_id == team_id,
        )
        .first()
    )

    if not question:
        raise HTTPException(status_code=404, detail="Question not found")

    # Run research agent
    try:
        finding = await research_agent.research_question(
            question=question.question,
            context=question.context,
            max_papers=50,
        )

        # Save belief if proposed
        if finding.proposed_belief:
            belief = Belief(
                team_id=team_id,
                belief_statement=finding.proposed_belief["statement"],
                confidence=finding.proposed_belief.get("confidence", 0.0),
                supporting_evidence=finding.reasoning,
                confidence_calculation={
                    "papers_analyzed": finding.papers_analyzed,
                    "contradictions_found": len(finding.contradictions),
                },
                status="proposed",
            )
            db.add(belief)

        # Save dead end if proposed
        if finding.proposed_dead_end:
            dead_end = DeadEnd(
                team_id=team_id,
                idea_title=finding.proposed_belief["statement"] if finding.proposed_belief else "Unknown",
                rejection_reason=finding.proposed_dead_end.get("reason", ""),
                related_papers=[p.get("arxiv_id") for p in finding.key_claims if "arxiv_id" in p],
                status="proposed",
            )
            db.add(dead_end)

        # Log task execution
        task_exec = TaskExecution(
            team_id=team_id,
            task_type="research_pipeline",
            selected_provider=finding.provider_used,
            input_tokens=0,
            output_tokens=0,
            cost_usd=0.0,
            execution_time_ms=finding.execution_time_ms,
            result={
                "papers_analyzed": finding.papers_analyzed,
                "contradictions": len(finding.contradictions),
                "belief_proposed": finding.proposed_belief is not None,
                "dead_end_proposed": finding.proposed_dead_end is not None,
            },
        )
        db.add(task_exec)

        # Update question
        question.last_research_at = datetime.utcnow()

        db.commit()

        return ResearchResponse(
            question_id=question_id,
            papers_analyzed=finding.papers_analyzed,
            proposed_belief=finding.proposed_belief,
            proposed_dead_end=finding.proposed_dead_end,
            confidence_score=finding.confidence_score,
            reasoning=finding.reasoning,
            provider_used=finding.provider_used,
            execution_time_ms=finding.execution_time_ms,
        )

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Research failed: {str(e)}")


@router.get("/teams/{team_id}/research/status")
async def get_research_status(
    team_id: str,
    db: Session = Depends(get_db),
):
    """Get status of ongoing research tasks."""

    tasks = (
        db.query(TaskExecution)
        .filter(TaskExecution.team_id == team_id)
        .order_by(TaskExecution.executed_at.desc())
        .limit(10)
        .all()
    )

    return {
        "active_tasks": 0,
        "completed_tasks": len(tasks),
        "recent_tasks": [
            {
                "id": t.id,
                "type": t.task_type,
                "provider": t.selected_provider,
                "execution_time": t.execution_time_ms,
                "executed_at": t.executed_at,
            }
            for t in tasks
        ],
    }
