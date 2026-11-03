"""승인 흐름: 승인, 수정, 재작성, 직접 작성으로 넘기기, 직접 작성 등록, 다시 수정.
작업 기록 조회와 기준값 변경도 여기에 있다.

두 상담사가 같은 문의를 동시에 처리하면 먼저 저장한 쪽만 적용된다.
- 문의 행을 잠그고(FOR UPDATE),
- 상담사가 화면에서 본 version이 지금 version과 같을 때만 처리한다.
"""
import logging

from app import inquiries as inq
from app.drafting import DraftError, verify_citations

logger = logging.getLogger(__name__)

CONFLICT_MESSAGE = "다른 상담사가 이미 처리했습니다. 최신 상태를 불러왔습니다."
REWRITE_FAIL_MESSAGE = "새 초안을 만들지 못했습니다. 첫 번째 초안은 그대로 두었으니 다시 눌러 주세요."
ACTION_KO = {"approve": "승인", "edit": "수정", "rewrite": "재작성", "manual_write": "직접 작성"}
THRESHOLD_MIN, THRESHOLD_MAX = 50, 95


class WorkflowError(Exception):
    """처리할 수 없을 때. message는 사용자에게 그대로 보여준다. inquiry가 있으면 최신 상태다."""

    def __init__(self, status_code, message, inquiry=None):
        super().__init__(message)
        self.status_code = status_code
        self.message = message
        self.inquiry = inquiry


def _lock(conn, policy, inquiry_id, version):
    row = conn.execute(
        "SELECT id, status, version, rewrite_count, body, predicted_label, confidence FROM inquiries"
        " WHERE id = %s FOR UPDATE",
        (inquiry_id,),
    ).fetchone()
    if row is None:
        raise WorkflowError(404, "문의를 찾을 수 없습니다.")
    if version is None:
        raise WorkflowError(400, "문의의 version 값이 필요합니다.")
    if row["version"] != version:
        raise WorkflowError(409, CONFLICT_MESSAGE, inq.get_detail(conn, policy, inquiry_id))
    return row


def _clean_reply(text):
    reply = (text or "").strip()
    if not reply:
        raise WorkflowError(400, "답장 내용을 입력하세요.")
    return reply


def _latest_draft(conn, inquiry_id):
    return conn.execute(
        "SELECT draft_no, content, cited_articles FROM drafts"
        " WHERE inquiry_id = %s ORDER BY draft_no DESC LIMIT 1",
        (inquiry_id,),
    ).fetchone()


def _log(conn, inquiry_id, agent_id, action, draft_text=None, new_draft_text=None, final_reply=None):
    conn.execute(
        "INSERT INTO action_logs (inquiry_id, agent_id, action, draft_text, new_draft_text, final_reply)"
        " VALUES (%s, %s, %s, %s, %s, %s)",
        (inquiry_id, agent_id, action, draft_text, new_draft_text, final_reply),
    )


def _finish(conn, inquiry_id, agent_id, reply):
    conn.execute(
        "UPDATE inquiries SET status = 'done', final_reply = %s, resolved_by = %s, resolved_at = now(),"
        " version = version + 1, updated_at = now() WHERE id = %s",
        (reply, agent_id, inquiry_id),
    )


def approve(conn, policy, agent, inquiry_id, version):
    row = _lock(conn, policy, inquiry_id, version)
    if row["status"] != "awaiting_approval":
        raise WorkflowError(409, "승인 대기 상태의 문의만 승인할 수 있습니다.")
    draft = _latest_draft(conn, inquiry_id)
    if draft is None:
        raise WorkflowError(409, "승인할 초안이 없습니다.")
    _finish(conn, inquiry_id, agent["id"], draft["content"])
    _log(conn, inquiry_id, agent["id"], "approve", draft_text=draft["content"], final_reply=draft["content"])
    return inq.get_detail(conn, policy, inquiry_id)


def edit(conn, policy, agent, inquiry_id, version, text):
    """승인 대기 문의의 초안을 고쳐 저장하면 바로 처리 완료('수정하여 승인').
    처리 완료된 문의는 최종 답장만 고친다('다시 수정'). 상태는 처리 완료 그대로다."""
    reply = _clean_reply(text)
    row = _lock(conn, policy, inquiry_id, version)
    draft = _latest_draft(conn, inquiry_id)
    if row["status"] == "awaiting_approval":
        if draft is None:
            raise WorkflowError(409, "수정할 초안이 없습니다.")
        _finish(conn, inquiry_id, agent["id"], reply)
    elif row["status"] == "done":
        conn.execute(
            "UPDATE inquiries SET final_reply = %s, version = version + 1, updated_at = now() WHERE id = %s",
            (reply, inquiry_id),
        )
    else:
        raise WorkflowError(409, "직접 작성 상태의 문의는 [직접 작성]으로 답장을 등록하세요.")
    _log(
        conn, inquiry_id, agent["id"], "edit",
        draft_text=draft["content"] if draft else None, final_reply=reply,
    )
    return inq.get_detail(conn, policy, inquiry_id)


def rewrite(conn, policy, drafter, agent, inquiry_id, version):
    """새 초안을 한 번 더 받는다. 문의당 1번만 된다. 실패하면 첫 초안을 그대로 두고 횟수로 세지 않는다."""
    row = _lock(conn, policy, inquiry_id, version)
    if row["status"] != "awaiting_approval":
        raise WorkflowError(409, "승인 대기 상태의 문의만 재작성할 수 있습니다.")
    if row["rewrite_count"] >= 1:
        raise WorkflowError(409, "재작성은 문의당 1번만 할 수 있습니다. 직접 작성으로 넘겨 주세요.")
    first = _latest_draft(conn, inquiry_id)
    if first is None:
        raise WorkflowError(409, "재작성할 초안이 없습니다.")

    # 첫 초안이 근거로 삼은 조항을 그대로 쓴다. 근거 조항이 없던 초안이면 처음과 같은 방식으로 다시 찾는다.
    clauses = [policy.get(i) for i in first["cited_articles"] if policy.exists(i)]
    if not clauses:
        search_label = inq.evidence_label(row["predicted_label"], row["confidence"], inq.get_threshold(conn))
        clauses = [c for c, _ in policy.find_evidence(search_label, row["body"])]

    try:
        result = drafter.draft(row["body"], clauses, avoid=first["content"])
        cited = verify_citations(result.cited, [c.id for c in clauses], policy)
    except DraftError as e:
        logger.warning("재작성에 실패했습니다: %s", e)
        raise WorkflowError(502, REWRITE_FAIL_MESSAGE) from e

    inq.insert_draft(conn, inquiry_id, 2, result.text, cited, result.uncovered_note or None)
    conn.execute(
        "UPDATE inquiries SET rewrite_count = 1, version = version + 1, updated_at = now() WHERE id = %s",
        (inquiry_id,),
    )
    _log(conn, inquiry_id, agent["id"], "rewrite", draft_text=first["content"], new_draft_text=result.text)
    return inq.get_detail(conn, policy, inquiry_id)


def handoff(conn, policy, agent, inquiry_id, version):
    """두 번째 초안에서 [직접 작성으로 넘기기]. 상태만 '직접 작성'으로 바뀐다."""
    row = _lock(conn, policy, inquiry_id, version)
    if row["status"] != "awaiting_approval" or row["rewrite_count"] < 1:
        raise WorkflowError(409, "재작성한 두 번째 초안에서만 직접 작성으로 넘길 수 있습니다.")
    conn.execute(
        "UPDATE inquiries SET status = 'manual', version = version + 1, updated_at = now() WHERE id = %s",
        (inquiry_id,),
    )
    return inq.get_detail(conn, policy, inquiry_id)


def manual_reply(conn, policy, agent, inquiry_id, version, text):
    reply = _clean_reply(text)
    row = _lock(conn, policy, inquiry_id, version)
    if row["status"] != "manual":
        raise WorkflowError(409, "직접 작성 상태의 문의만 답장을 등록할 수 있습니다.")
    _finish(conn, inquiry_id, agent["id"], reply)
    _log(conn, inquiry_id, agent["id"], "manual_write", final_reply=reply)
    return inq.get_detail(conn, policy, inquiry_id)


# --- 작업 기록 ---------------------------------------------------------------

def list_logs(conn, agent_username=None, action=None, limit=200):
    if action is not None and action not in ACTION_KO:
        raise WorkflowError(400, f"알 수 없는 행동입니다: {action}")
    where, params = [], []
    if agent_username:
        where.append("a.username = %s")
        params.append(agent_username)
    if action:
        where.append("l.action = %s")
        params.append(action)
    sql = (
        "SELECT l.id, l.created_at, l.action, l.inquiry_id, l.draft_text, l.new_draft_text, l.final_reply,"
        " a.username AS agent_username, a.display_name AS agent_name, i.body AS inquiry_body"
        " FROM action_logs l JOIN agents a ON a.id = l.agent_id JOIN inquiries i ON i.id = l.inquiry_id"
        + (" WHERE " + " AND ".join(where) if where else "")
        + " ORDER BY l.created_at DESC, l.id DESC LIMIT %s"
    )
    rows = conn.execute(sql, (*params, limit)).fetchall()
    return [dict(r, action_ko=ACTION_KO[r["action"]]) for r in rows]


# --- 기준값 -----------------------------------------------------------------

def set_threshold(conn, agent_id, value):
    if isinstance(value, bool) or not isinstance(value, int):
        raise WorkflowError(400, "기준값은 숫자(정수)로 입력하세요.")
    if not THRESHOLD_MIN <= value <= THRESHOLD_MAX:
        raise WorkflowError(400, f"기준값은 {THRESHOLD_MIN}~{THRESHOLD_MAX} 사이여야 합니다.")
    conn.execute(
        "UPDATE settings SET value = %s, updated_by = %s, updated_at = now()"
        " WHERE key = 'confidence_threshold'",
        (str(value), agent_id),
    )
    return value
