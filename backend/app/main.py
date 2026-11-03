"""서버 시작점.

실행 (backend 폴더에서):
    .venv\\Scripts\\python.exe -m uvicorn app.main:create_app --factory --reload
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.sessions import SessionMiddleware

from app.classifier import Classifier
from app.config import load_settings
from app.db import make_pool
from app.drafting import OpenAIDrafter
from app.policy import make_policy
from app.routers import auth, evaluations, inquiries, logs, settings as settings_router, stats as stats_router
from app.workflow import WorkflowError
from ml.data import EVAL_PATH


def create_app(schema=None, classifier=None, policy=None, drafter=None, eval_path=None):
    """schema, classifier, policy, drafter, eval_path는 시험에서만 쓴다. 평소에는 비워 둔다."""
    settings = load_settings()
    policy = policy or make_policy(settings)
    drafter = drafter or OpenAIDrafter(settings.openai_api_key, settings.openai_model)

    @asynccontextmanager
    async def lifespan(app):
        pool = make_pool(settings.database_url, schema)
        pool.open(wait=True, timeout=30)
        app.state.pool = pool
        app.state.classifier = classifier or Classifier()
        app.state.policy = policy
        app.state.drafter = drafter
        app.state.eval_path = eval_path or EVAL_PATH
        try:
            yield
        finally:
            pool.close()

    app = FastAPI(title="고동동 CS", lifespan=lifespan)

    # max_age=None: 로그인 정보가 브라우저를 닫으면 사라지는 쿠키로 저장된다.
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.session_secret,
        session_cookie="session",
        max_age=None,
        same_site="lax",
        https_only=False,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(WorkflowError)
    async def workflow_error_handler(request: Request, exc: WorkflowError):
        body = {"detail": exc.message}
        if exc.inquiry is not None:  # 충돌이면 최신 상태를 함께 돌려준다
            body["inquiry"] = jsonable_encoder(exc.inquiry)
        return JSONResponse(status_code=exc.status_code, content=body)

    app.include_router(auth.router)
    app.include_router(inquiries.router)
    app.include_router(settings_router.router)
    app.include_router(logs.router)
    app.include_router(evaluations.router)
    app.include_router(stats_router.router)
    return app
