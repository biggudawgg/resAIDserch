from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db

router = APIRouter()


class BeliefResponse(BaseModel):
    message: str


@router.get("/teams/{team_id}/beliefs", response_model=BeliefResponse)
async def list_beliefs():
    return {"message": "Beliefs endpoint - coming soon"}


@router.post("/teams/{team_id}/beliefs", response_model=BeliefResponse)
async def create_belief():
    return {"message": "Create belief endpoint - coming soon"}
