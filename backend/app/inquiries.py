"""문의 저장과 조회. 분류 결과와 초안 만들기 결과에 따라 문의의 상태를 정한다."""
import logging

from psycopg.types.json import Jsonb

from app import risk
from app.drafting import CitationError, DraftError, verify_citations
from ml.labels import LABEL_KO, LABEL_WHO_KO

logger = logging.getLogger(__name__)

MAX_BODY_LENGTH = 1000
DEFAULT_THRESHOLD = 70
AUTO_FAIL_NOTE = "자동 처리에 실패해 직접 작성으로 넘어갔습니다."
BAD_CITATION_NOTE = "초안이 규정 문서에 없는 조항 번호를 근거로 삼아 직접 작성으로 넘어갔습니다."
CLASSIFY_FAIL_NOTE = "문의 종류를 분류하지 못했습니다. 문의 내용을 직접 확인해 주세요."


def low_confidence_note(threshold_percent):
    return f"분류 확신도가 기준값({threshold_percent}%)보다 낮습니다. 문의 종류가 맞는지 먼저 확인해 주세요."

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


def is_low_confidence(confidence, threshold_percent):
    """확신도가 기준값보다 낮은지. 낮아도 초안은 쓰고, 경고만 띄운다."""
    return round(confidence * 100, 6) < threshold_percent


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


def available_actions(inquiry, has_draft):
    """지금 상태에서 상담사가 누를 수 있는 버튼."""
    status = inquiry["status"]
    if status == "awaiting_approval" and has_draft:
        second = "handoff" if inquiry["rewrite_count"] >= 1 else "rewrite"
        return ["approve", "edit", second]
    if status == "manual":
        return ["manual_reply"]
    if status == "done":
        return ["reedit"]
    return []


def get_detail(conn, policy, inquiry_id):
    """문의 한 건과 초안, 규정 문서, 위험 표현 경고를 함께 돌려준다."""
    inquiry = get_inquiry(conn, inquiry_id)
    if inquiry is None:
        return None

    rows = conn.execute(
        "SELECT draft_no, content, cited_articles, uncovered_note, created_at FROM drafts"
        " WHERE inquiry_id = %s ORDER BY draft_no",
        (inquiry_id,),
    ).fetchall()
    drafts = [
        {
            "draft_no": r["draft_no"],
            "content": r["content"],
            "cited": list(r["cited_articles"]),
            "uncovered_note": r["uncovered_note"],
            "created_at": r["created_at"],
        }
        for r in rows
    ]
    current = drafts[-1] if drafts else None
    evidence = []
    if current:
        evidence = [policy.get(i).to_dict() for i in current["cited"] if policy.exists(i)]

    text = None
    if inquiry["status"] == "awaiting_approval" and current:
        text = current["content"]
    elif inquiry["final_reply"]:
        text = inquiry["final_reply"]
    warnings = risk.find_risks(text, risk.list_phrases(conn)) if text else []

    inquiry.update(
        drafts=drafts,
        current_draft=current,
        evidence=evidence,
        legacy_only=bool(evidence) and all(e["legacy"] for e in evidence),
        risk_warnings=warnings,
        actions=available_actions(inquiry, has_draft=current is not None),
    )
    return inquiry


def insert_draft(conn, inquiry_id, draft_no, text, cited, uncovered_note=None):
    conn.execute(
        "INSERT INTO drafts (inquiry_id, draft_no, content, cited_articles, uncovered_note)"
        " VALUES (%s, %s, %s, %s, %s)",
        (inquiry_id, draft_no, text, Jsonb(list(cited)), uncovered_note or None),
    )


def evidence_label(label, confidence, threshold_percent):
    """규정 문서를 찾을 때 쓸 문의 종류. 분류를 믿을 수 없으면 None(정책 전체에서 찾는다)."""
    if label is None or confidence is None or is_low_confidence(confidence, threshold_percent):
        return None
    return label


def prepare_initial_draft(policy, drafter, search_label, body):
    """규정 문서를 찾아 첫 초안을 만든다. (초안 글, 규정 문서 번호, 근거에 없는 내용, 안내 문구)를 돌려준다.

    규정 문서를 못 찾아도 초안은 쓴다 (규정 문서 번호는 빈 목록, 근거에 없는 내용이 채워진다).
    초안 자체를 만들 수 없을 때만 (None, None, None, 안내 문구) 이고, 그 문의는 '직접 작성'으로 간다.
    """
    clauses = [c for c, _ in policy.find_evidence(search_label, body)]
    try:
        result = drafter.draft(body, clauses)
        cited = verify_citations(result.cited, [c.id for c in clauses], policy)
    except CitationError as e:
        logger.warning("초안의 규정 문서 번호가 잘못되었습니다: %s", e)
        return None, None, None, BAD_CITATION_NOTE
    except DraftError as e:
        logger.warning("초안 만들기에 실패했습니다: %s", e)
        return None, None, None, AUTO_FAIL_NOTE
    return result.text, cited, result.uncovered_note or None, None


def create_inquiry(conn, classifier, policy, drafter, raw_body, agent_id=None, source="user"):
    """문의를 저장하고 분류한 뒤, 모든 문의에 규정 문서를 찾아 초안을 붙인다.

    확신도가 기준값보다 낮으면 초안은 쓰되 경고 문구를 남기고, 정책 전체에서 근거를 찾는다.
    분류나 초안 만들기가 실패해도 문의는 저장한다. 초안을 못 만들면 '직접 작성'으로 보낸다.
    """
    body = validate_body(raw_body)
    threshold = get_threshold(conn)

    note = None
    try:
        label, confidence = classifier.classify(body)
        if is_low_confidence(confidence, threshold):
            note = low_confidence_note(threshold)
    except Exception:
        logger.exception("문의 분류에 실패했습니다")
        label, confidence, note = None, None, CLASSIFY_FAIL_NOTE

    try:
        draft_text, cited, uncovered, fail_note = prepare_initial_draft(
            policy, drafter, evidence_label(label, confidence, threshold), body
        )
    except Exception:
        logger.exception("초안 만들기 중 예상하지 못한 오류가 났습니다")
        draft_text, cited, uncovered, fail_note = None, None, None, AUTO_FAIL_NOTE
    status = "awaiting_approval"
    if draft_text is None:
        status, note = "manual", fail_note

    row = conn.execute(
        "INSERT INTO inquiries (body, status, predicted_label, confidence, auto_note, source, created_by)"
        " VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
        (body, status, label, confidence, note, source, agent_id),
    ).fetchone()
    if draft_text is not None:
        insert_draft(conn, row["id"], 1, draft_text, cited, uncovered)
    return get_inquiry(conn, row["id"])


def backfill_drafts(conn, policy, drafter):
    """초안이 없는 '승인 대기' 문의에 초안을 붙인다. 못 만들면 '직접 작성'으로 보낸다.

    Phase 2에서 들어간 문의처럼 초안 없이 승인 대기가 된 문의를 바로잡는 용도다.
    (붙인 개수, 직접 작성으로 보낸 개수)를 돌려준다.
    """
    threshold = get_threshold(conn)
    rows = conn.execute(
        "SELECT i.id, i.body, i.predicted_label, i.confidence FROM inquiries i"
        " WHERE i.status = 'awaiting_approval'"
        " AND NOT EXISTS (SELECT 1 FROM drafts d WHERE d.inquiry_id = i.id) ORDER BY i.id"
    ).fetchall()
    attached = moved = 0
    for row in rows:
        label = evidence_label(row["predicted_label"], row["confidence"], threshold)
        text, cited, uncovered, note = prepare_initial_draft(policy, drafter, label, row["body"])
        if text is not None:
            insert_draft(conn, row["id"], 1, text, cited, uncovered)
            attached += 1
        else:
            conn.execute(
                "UPDATE inquiries SET status = 'manual', auto_note = %s, version = version + 1,"
                " updated_at = now() WHERE id = %s",
                (note, row["id"]),
            )
            moved += 1
    return attached, moved
