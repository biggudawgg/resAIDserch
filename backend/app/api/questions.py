from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from typing import List
from pydantic import BaseModel
from datetime import datetime

from app.models import ResearchQuestion, Team, User
from app.core.database import get_db

router = APIRouter()


class ResearchQuestionCreate(BaseModel):
    question: str
    context: str | None = None


class ResearchQuestionUpdate(BaseModel):
    question: str | None = None
    status: str | None = None
    context: str | None = None


class ResearchQuestionResponse(BaseModel):
    id: str
    team_id: str
    question: str
    status: str
    context: str | None
    created_at: datetime
    updated_at: datetime
    last_research_at: datetime | None

    class Config:
        from_attributes = True


@router.post("/teams/{team_id}/questions", response_model=ResearchQuestionResponse)
async def create_research_question(
    team_id: str,
    question_data: ResearchQuestionCreate,
    db: Session = Depends(get_db),
):
    """Create a new research question (triggers research agent)."""

    # Verify team exists
    team = db.query(Team).filter(Team.id == team_id).first()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    # Create question
    new_question = ResearchQuestion(
        team_id=team_id,
        question=question_data.question,
        context=question_data.context,
        created_by="system",  # TODO: Get from auth
        status="active",
    )

    db.add(new_question)
    db.commit()
    db.refresh(new_question)

    return new_question


@router.get("/teams/{team_id}/questions", response_model=List[ResearchQuestionResponse])
async def list_research_questions(
    team_id: str,
    status: str | None = None,
    db: Session = Depends(get_db),
):
    """List all research questions for a team."""

    query = db.query(ResearchQuestion).filter(ResearchQuestion.team_id == team_id)

    if status:
        query = query.filter(ResearchQuestion.status == status)

    return query.order_by(ResearchQuestion.created_at.desc()).all()


@router.get("/teams/{team_id}/questions/{question_id}", response_model=ResearchQuestionResponse)
async def get_research_question(
    team_id: str,
    question_id: str,
    db: Session = Depends(get_db),
):
    """Get a specific research question."""

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

    return question


@router.put("/teams/{team_id}/questions/{question_id}", response_model=ResearchQuestionResponse)
async def update_research_question(
    team_id: str,
    question_id: str,
    update_data: ResearchQuestionUpdate,
    db: Session = Depends(get_db),
):
    """Update a research question."""

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

    # Update fields
    if update_data.question:
        question.question = update_data.question
    if update_data.status:
        question.status = update_data.status
    if update_data.context is not None:
        question.context = update_data.context

    question.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(question)

    return question


@router.delete("/teams/{team_id}/questions/{question_id}")
async def delete_research_question(
    team_id: str,
    question_id: str,
    db: Session = Depends(get_db),
):
    """Delete a research question."""

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

    db.delete(question)
    db.commit()

    return {"message": "Question deleted"}
