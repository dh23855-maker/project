"""문의 저장과 조회, 분류 결과에 따른 상태 결정."""
import logging

from ml.labels import LABEL_KO, LABEL_WHO_KO

logger = logging.getLogger(__name__)

MAX_BODY_LENGTH = 1000
DEFAULT_THRESHOLD = 70
AUTO_FAIL_NOTE = "자동 처리에 실패해 직접 작성으로 넘어갔습니다."

STATUS_KO = {
    "awaiting_approval": "승인 대기",
    "manual": "직접 작성",
    "done": "처리 완료",
}

SELECT_INQUIRY = """
SELECT i.id, i.body, i.status, i.predicted_label, i.confidence, i.auto_note,
       i.rewrite_count, i.final_reply, i.resolved_at, i.source, i.version, i.created_at,
       r.display_name AS resolved_by_name,
       c.display_name AS created_by_name
FROM inquiries i
LEFT JOIN agents r ON r.id = i.resolved_by
LEFT JOIN agents c ON c.id = i.created_by
"""


class InvalidInquiry(ValueError):
    """문의 내용이 규칙에 맞지 않을 때. 메시지는 사용자에게 그대로 보여준다."""


def validate_body(raw):
    body = (raw or "").strip()
    if not body:
        raise InvalidInquiry("문의 내용을 입력하세요.")
    if len(body) > MAX_BODY_LENGTH:
        raise InvalidInquiry(
            f"문의 내용은 {MAX_BODY_LENGTH}자까지 입력할 수 있습니다. 지금은 {len(body)}자입니다."
        )
    return body


def decide_status(confidence, threshold_percent):
    """확신도가 기준값 이상이면 승인 대기, 아니면 직접 작성.

    (정책 근거를 찾았는지 보는 조건은 Phase 3에서 이 규칙에 더해진다.)
    """
    return "awaiting_approval" if round(confidence * 100, 6) >= threshold_percent else "manual"


def get_threshold(conn):
    row = conn.execute("SELECT value FROM settings WHERE key = 'confidence_threshold'").fetchone()
    return int(row["value"]) if row else DEFAULT_THRESHOLD


def to_out(row):
    label = row["predicted_label"]
    confidence = row["confidence"]
    return {
        "id": row["id"],
        "body": row["body"],
        "status": row["status"],
        "status_ko": STATUS_KO[row["status"]],
        "predicted_label": label,
        "predicted_label_ko": LABEL_KO.get(label),
        "asker": LABEL_WHO_KO.get(label),
        "confidence_percent": None if confidence is None else round(confidence * 100, 1),
        "auto_note": row["auto_note"],
        "rewrite_count": row["rewrite_count"],
        "final_reply": row["final_reply"],
        "resolved_by_name": row["resolved_by_name"],
        "resolved_at": row["resolved_at"],
        "source": row["source"],
        "created_by_name": row["created_by_name"],
        "version": row["version"],
        "created_at": row["created_at"],
    }


def get_inquiry(conn, inquiry_id):
    row = conn.execute(SELECT_INQUIRY + " WHERE i.id = %s", (inquiry_id,)).fetchone()
    return to_out(row) if row else None


def list_inquiries(conn):
    rows = conn.execute(SELECT_INQUIRY + " ORDER BY i.created_at DESC, i.id DESC").fetchall()
    return [to_out(r) for r in rows]


def create_inquiry(conn, classifier, raw_body, agent_id=None, source="user"):
    """문의를 저장하고 분류한다. 분류가 실패해도 문의는 저장하고 '직접 작성'으로 보낸다."""
    body = validate_body(raw_body)
    threshold = get_threshold(conn)

    try:
        label, confidence = classifier.classify(body)
        status = decide_status(confidence, threshold)
        note = None
    except Exception:
        logger.exception("문의 분류에 실패했습니다")
        label, confidence, status, note = None, None, "manual", AUTO_FAIL_NOTE

    row = conn.execute(
        "INSERT INTO inquiries (body, status, predicted_label, confidence, auto_note, source, created_by)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (body, status, label, confidence, note, source, agent_id),
    ).fetchone()
    return get_inquiry(conn, row["id"])
