"""작업 기록 보기. 상담사와 행동으로 거를 수 있다."""
from fastapi import APIRouter, Depends, Query

from app import workflow
from app.deps import current_agent, get_conn
from app.schemas import ActionLogOut

router = APIRouter(prefix="/api", tags=["logs"])


@router.get("/action-logs", response_model=list[ActionLogOut])
def action_logs(
    agent_username: str | None = Query(None, alias="agent", description="상담사 아이디 (예: kim)"),
    action: str | None = Query(None, description="approve / edit / rewrite / manual_write"),
    limit: int = Query(200, ge=1, le=500),
    agent=Depends(current_agent),
    conn=Depends(get_conn),
):
    return workflow.list_logs(conn, agent_username or None, action or None, limit)
