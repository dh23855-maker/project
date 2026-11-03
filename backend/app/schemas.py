"""요청과 응답의 모양."""
from datetime import datetime
from typing import Any

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


class DraftOut(BaseModel):
    draft_no: int
    content: str
    cited: list[str]
    uncovered_note: str | None = None  # 근거 조항에는 없는 내용 (없으면 None)
    created_at: datetime


class EvidenceOut(BaseModel):
    id: str
    title: str
    label: str
    legacy: bool
    content: str


class RiskWarning(BaseModel):
    sentence: str
    phrases: list[str]


class InquiryDetail(InquiryOut):
    """문의 한 건: 초안, 근거 조항, 위험 표현 경고, 지금 누를 수 있는 버튼까지."""

    drafts: list[DraftOut]
    current_draft: DraftOut | None
    evidence: list[EvidenceOut]
    legacy_only: bool
    risk_warnings: list[RiskWarning]
    actions: list[str]


class VersionIn(BaseModel):
    """상담사가 화면에서 본 문의의 version. 그 사이 다른 상담사가 처리했다면 거절된다."""

    version: int | None = None


class ReplyIn(VersionIn):
    text: str | None = None


class ThresholdIn(BaseModel):
    value: Any = None


class SettingsOut(BaseModel):
    confidence_threshold: int
    min: int
    max: int


class PhraseIn(BaseModel):
    phrase: str | None = None


class RiskyPhraseOut(BaseModel):
    id: int
    phrase: str
    created_at: datetime
    created_by_name: str | None


class RiskCheckIn(BaseModel):
    text: str | None = None


class RiskCheckOut(BaseModel):
    warnings: list[RiskWarning]


class ActionLogOut(BaseModel):
    id: int
    created_at: datetime
    action: str
    action_ko: str
    inquiry_id: int
    inquiry_body: str
    agent_username: str
    agent_name: str
    draft_text: str | None
    new_draft_text: str | None
    final_reply: str | None
