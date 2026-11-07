from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.core.database import get_db

router = APIRouter()


class AuthResponse(BaseModel):
    message: str


@router.post("/login", response_model=AuthResponse)
async def login():
    return {"message": "Auth endpoint - coming soon"}


@router.post("/register", response_model=AuthResponse)
async def register():
    return {"message": "Auth endpoint - coming soon"}
