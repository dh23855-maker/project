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
    quick_approvable: bool = False  # 빠른 승인 조건을 모두 만족하는 승인 대기 문의


class DraftOut(BaseModel):
    draft_no: int
    content: str
    cited: list[str]
    uncovered_note: str | None = None  # 규정 문서에는 없는 내용 (없으면 None)
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
    """문의 한 건: 초안, 규정 문서, 위험 표현 경고, 지금 누를 수 있는 버튼까지."""

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


class QuickApproveItem(VersionIn):
    id: int


class QuickApproveIn(BaseModel):
    items: list[QuickApproveItem] = []


class QuickSkipped(BaseModel):
    id: int
    reason: str


class QuickApproveOut(BaseModel):
    approved: list[int]
    skipped: list[QuickSkipped]


class SimilarItem(BaseModel):
    id: int
    body: str
    predicted_label_ko: str | None
    final_reply: str
    resolved_at: datetime | None
    similarity_percent: float


class SimilarOut(BaseModel):
    items: list[SimilarItem]


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


class EvaluationSummary(BaseModel):
    """평가 실행 한 번의 요약 (이전 실행 목록용)."""

    id: int
    created_at: datetime
    run_by_name: str | None
    total: int
    correct: int
    accuracy: float | None
    description: str | None


class LabelStat(BaseModel):
    total: int
    correct: int
    accuracy: float | None


class Confusion(BaseModel):
    true: str
    predicted: str
    count: int


class WrongItem(BaseModel):
    text: str
    true: str
    predicted: str
    difficulty: str | None = None
    confidence: float | None = None


class LabelName(BaseModel):
    key: str
    ko: str


class EvaluationDetail(EvaluationSummary):
    per_label: dict[str, LabelStat]
    per_difficulty: dict[str, LabelStat] | None
    confusions: list[Confusion]
    wrong: list[WrongItem]
    train_size: int | None
    eval_file: str | None
    labels: list[LabelName]
    difficulties: list[str]


class StatsBreakdown(BaseModel):
    """묶음(전체, 종류, 칸) 하나의 초안·확신도 현황."""

    drafted: int  # 초안이 있는 문의 수
    uncovered: int  # 그중 규정 문서에는 없는 내용이 있는 문의 수
    uncovered_percent: float | None  # uncovered / drafted (초안이 없으면 None)
    low_confidence: int  # 확신도가 기준값보다 낮거나 분류를 못 한 문의 수
    low_confidence_percent: float | None  # low_confidence / 전체 (문의가 없으면 None)


class StatsOverall(StatsBreakdown):
    total: int


class StatsType(StatsBreakdown):
    code: str
    name: str
    who: str  # 구매자 / 판매자 (분류 없음은 빈 글자)
    count: int
    percent: float


class StatsBucket(StatsOverall):
    key: str  # 날짜(2026-11-03) 또는 시간(09)
    label: str
    counts: dict[str, int]  # 종류 코드 -> 건수 (모든 종류, 없으면 0)


class StatsHandling(BaseModel):
    statuses: dict[str, int]  # 승인 대기 / 직접 작성 / 처리 완료 건수
    done: int
    resolution: dict[str, int]  # 처리 완료 문의를 마지막에 처리한 방법: approve / edit / manual_write
    approve_percent: float | None  # 초안 그대로 승인된 비율 (처리 완료 중)
    rewrite_count: int
    rewrite_percent: float | None
    median_minutes: float | None  # 들어온 뒤 처리까지 걸린 시간(분)의 중앙값
    average_minutes: float | None


class InquiryStatsOut(BaseModel):
    days: int
    unit: str  # day 또는 hour
    elapsed: int  # 지금까지 지난 칸 수 (하루 평균·시간당 평균을 구할 때 쓴다)
    today: str  # 서버가 아는 한국 시간의 오늘 (YYYY-MM-DD)
    start: str
    end: str
    total: int
    threshold: int  # 지금의 확신도 기준값(%)
    overall: StatsOverall
    types: list[StatsType]
    buckets: list[StatsBucket]
    handling: StatsHandling
