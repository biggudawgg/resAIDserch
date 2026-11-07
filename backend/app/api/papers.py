from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db

router = APIRouter()


class PaperResponse(BaseModel):
    message: str


@router.get("/search", response_model=PaperResponse)
async def search_papers():
    return {"message": "Paper search endpoint - coming soon"}


@router.post("/upload", response_model=PaperResponse)
async def upload_paper():
    return {"message": "Paper upload endpoint - coming soon"}
