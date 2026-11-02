"""여러 요청에서 함께 쓰는 준비물: DB 연결, 로그인한 상담사 확인."""
from fastapi import Depends, HTTPException, Request

NOT_LOGGED_IN = "로그인이 필요합니다."


def get_conn(request: Request):
    with request.app.state.pool.connection() as conn:
        yield conn


def current_agent(request: Request, conn=Depends(get_conn)):
    agent_id = request.session.get("agent_id")
    if agent_id is None:
        raise HTTPException(status_code=401, detail=NOT_LOGGED_IN)
    agent = conn.execute(
        "SELECT id, username, display_name FROM agents WHERE id = %s", (agent_id,)
    ).fetchone()
    if agent is None:  # 계정이 사라졌다면 로그인 상태도 풀어 준다
        request.session.clear()
        raise HTTPException(status_code=401, detail=NOT_LOGGED_IN)
    return agent
