from sqlalchemy import Column, String, Integer, Float, DateTime, Text, JSON, Boolean, ForeignKey, Table, Enum, ARRAY, DECIMAL
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid
import enum

Base = declarative_base()

class Team(Base):
    __tablename__ = "teams"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String(255), nullable=False)
    project_name = Column(String(255), nullable=True)
    project_end_date = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    members = relationship("TeamMember", back_populates="team", cascade="all, delete-orphan")
    questions = relationship("ResearchQuestion", back_populates="team", cascade="all, delete-orphan")
    papers = relationship("Paper", back_populates="team", cascade="all, delete-orphan")
    beliefs = relationship("Belief", back_populates="team", cascade="all, delete-orphan")
    dead_ends = relationship("DeadEnd", back_populates="team", cascade="all, delete-orphan")
    meetings = relationship("Meeting", back_populates="team", cascade="all, delete-orphan")
    task_executions = relationship("TaskExecution", back_populates="team", cascade="all, delete-orphan")


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    team_members = relationship("TeamMember", back_populates="user", cascade="all, delete-orphan")
    api_providers = relationship("AIProviderConfig", back_populates="user", cascade="all, delete-orphan")


class TeamMember(Base):
    __tablename__ = "team_members"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    team_id = Column(String, ForeignKey("teams.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    email = Column(String(255), nullable=False)
    role = Column(String(50), default="researcher")
    joined_at = Column(DateTime, default=datetime.utcnow)

    team = relationship("Team", back_populates="members")
    user = relationship("User", back_populates="team_members")


class ResearchQuestion(Base):
    __tablename__ = "research_questions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    team_id = Column(String, ForeignKey("teams.id"), nullable=False, index=True)
    question = Column(Text, nullable=False)
    status = Column(String(50), default="active")
    context = Column(Text, nullable=True)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    last_research_at = Column(DateTime, nullable=True)

    team = relationship("Team", back_populates="questions")


class Paper(Base):
    __tablename__ = "papers"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    team_id = Column(String, ForeignKey("teams.id"), nullable=False, index=True)
    doi = Column(String(255), nullable=True)
    arxiv_id = Column(String(50), nullable=True, unique=True, index=True)
    title = Column(String(500), nullable=False, index=True)
    authors = Column(ARRAY(String), nullable=True)
    published_date = Column(DateTime, nullable=True)
    abstract = Column(Text, nullable=True)
    full_text = Column(Text, nullable=True)
    source = Column(String(50), nullable=False)
    source_url = Column(String(500), nullable=True)
    pdf_url = Column(String(500), nullable=True)
    remote_pdf_path = Column(String(500), nullable=True)
    paper_metadata = Column(JSON, nullable=True)
    added_by = Column(String, ForeignKey("users.id"), nullable=True)
    added_at = Column(DateTime, default=datetime.utcnow, index=True)

    team = relationship("Team", back_populates="papers")
    readings = relationship("PaperReading", back_populates="paper", cascade="all, delete-orphan")


class PaperReading(Base):
    __tablename__ = "paper_readings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    paper_id = Column(String, ForeignKey("papers.id"), nullable=False, index=True)
    team_member_id = Column(String, ForeignKey("team_members.id"), nullable=False)
    read_at = Column(DateTime, default=datetime.utcnow)
    key_points = Column(Text, nullable=True)
    relevance_score = Column(Integer, nullable=True)
    notes = Column(Text, nullable=True)

    paper = relationship("Paper", back_populates="readings")


class Belief(Base):
    __tablename__ = "beliefs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    team_id = Column(String, ForeignKey("teams.id"), nullable=False, index=True)
    belief_statement = Column(Text, nullable=False)
    confidence = Column(Float, default=0.0)
    confidence_calculation = Column(JSON, nullable=True)
    supporting_evidence = Column(Text, nullable=True)
    sources = Column(ARRAY(String), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    changed_by = Column(String, ForeignKey("users.id"), nullable=True)
    history = Column(JSON, nullable=True)
    status = Column(String(50), default="active")

    team = relationship("Team", back_populates="beliefs")


class DeadEnd(Base):
    __tablename__ = "dead_ends"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    team_id = Column(String, ForeignKey("teams.id"), nullable=False, index=True)
    idea_title = Column(String(500), nullable=False)
    description = Column(Text, nullable=True)
    rejection_reason = Column(Text, nullable=False)
    rejected_by = Column(String, ForeignKey("users.id"), nullable=True)
    related_papers = Column(ARRAY(String), nullable=True)
    revisit_trigger = Column(Text, nullable=True)
    rejected_at = Column(DateTime, default=datetime.utcnow, index=True)
    status = Column(String(50), default="rejected")

    team = relationship("Team", back_populates="dead_ends")


class Meeting(Base):
    __tablename__ = "meetings"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    team_id = Column(String, ForeignKey("teams.id"), nullable=False, index=True)
    date = Column(DateTime, nullable=False, index=True)
    title = Column(String(255), nullable=True)
    transcript = Column(Text, nullable=True)
    transcribed_by = Column(String(50), nullable=True)
    recording_path = Column(String(500), nullable=True)
    processed_at = Column(DateTime, nullable=True)
    meeting_metadata = Column(JSON, nullable=True)

    team = relationship("Team", back_populates="meetings")
    stances = relationship("MeetingStance", back_populates="meeting", cascade="all, delete-orphan")


class MeetingStance(Base):
    __tablename__ = "meeting_stances"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    meeting_id = Column(String, ForeignKey("meetings.id"), nullable=False, index=True)
    team_member_id = Column(String, ForeignKey("team_members.id"), nullable=False)
    topic = Column(String(500), nullable=False)
    stance = Column(String(50), nullable=False)
    reason = Column(Text, nullable=True)
    quote = Column(Text, nullable=True)
    confidence = Column(Integer, nullable=True)
    verified = Column(Boolean, default=False)

    meeting = relationship("Meeting", back_populates="stances")


class TaskExecution(Base):
    __tablename__ = "task_executions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    team_id = Column(String, ForeignKey("teams.id"), nullable=False, index=True)
    task_type = Column(String(100), nullable=False, index=True)
    selected_provider = Column(String(50), nullable=False)
    selection_reason = Column(Text, nullable=True)
    input_tokens = Column(Integer, nullable=True)
    output_tokens = Column(Integer, nullable=True)
    cost_usd = Column(DECIMAL(10, 6), nullable=True)
    execution_time_ms = Column(Integer, nullable=True)
    task_result = Column(JSON, nullable=True)
    task_error = Column(Text, nullable=True)
    fallback_provider = Column(String(50), nullable=True)
    executed_at = Column(DateTime, default=datetime.utcnow, index=True)

    team = relationship("Team", back_populates="task_executions")


class AIProviderConfig(Base):
    __tablename__ = "ai_provider_config"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    provider = Column(String(50), nullable=False)
    api_key_encrypted = Column(String(500), nullable=True)
    model_id = Column(String(255), nullable=True)
    enabled = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="api_providers")


class AuditLog(Base):
    __tablename__ = "audit_log"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    team_id = Column(String, ForeignKey("teams.id"), nullable=False, index=True)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    action = Column(String(100), nullable=False)
    resource_type = Column(String(50), nullable=False)
    resource_id = Column(String, nullable=True)
    changes = Column(JSON, nullable=True)
    ip_address = Column(String(50), nullable=True)
    user_agent = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
