"""로그인, 로그아웃, 지금 로그인한 상담사 확인."""
from fastapi import APIRouter, Depends, HTTPException, Request

from app.deps import current_agent, get_conn
from app.schemas import AgentOut, LoginIn, LoginOut
from app.security import verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])

BAD_CREDENTIALS = "아이디 또는 비밀번호가 맞지 않습니다."


@router.post("/login", response_model=LoginOut)
def login(payload: LoginIn, request: Request, conn=Depends(get_conn)):
    username = (payload.username or "").strip()
    password = payload.password or ""
    if not username or not password:
        raise HTTPException(status_code=400, detail="아이디와 비밀번호를 입력하세요.")

    row = conn.execute(
        "SELECT id, username, display_name, password_hash FROM agents WHERE username = %s",
        (username,),
    ).fetchone()
    if not verify_password(password, row["password_hash"] if row else None):
        # 아이디가 틀렸는지 비밀번호가 틀렸는지는 알려주지 않는다.
        raise HTTPException(status_code=401, detail=BAD_CREDENTIALS)

    request.session.clear()
    request.session["agent_id"] = row["id"]
    return {"agent": {"id": row["id"], "username": row["username"], "display_name": row["display_name"]}}


@router.post("/logout", status_code=204)
def logout(request: Request):
    request.session.clear()


@router.get("/me", response_model=AgentOut)
def me(agent=Depends(current_agent)):
    return agent
