"""요청과 응답의 모양."""
from datetime import datetime

from pydantic import BaseModel


class LoginIn(BaseModel):
    username: str | None = None
    password: str | None = None


class AgentOut(BaseModel):
    id: int
    username: str
    display_name: str


class LoginOut(BaseModel):
    agent: AgentOut


class InquiryCreate(BaseModel):
    body: str | None = None


class InquiryOut(BaseModel):
    id: int
    body: str
    status: str
    status_ko: str
    predicted_label: str | None
    predicted_label_ko: str | None
    asker: str | None
    confidence_percent: float | None
    auto_note: str | None
    rewrite_count: int
    final_reply: str | None
    resolved_by_name: str | None
    resolved_at: datetime | None
    source: str
    created_by_name: str | None
    version: int
    created_at: datetime
