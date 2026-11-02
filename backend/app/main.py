"""서버 시작점.

실행 (backend 폴더에서):
    .venv\\Scripts\\python.exe -m uvicorn app.main:create_app --factory --reload
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware

from app.classifier import Classifier
from app.config import load_settings
from app.db import make_pool
from app.routers import auth, inquiries


def create_app(schema=None, classifier=None):
    """schema, classifier는 시험에서만 쓴다. 평소에는 비워 둔다."""
    settings = load_settings()

    @asynccontextmanager
    async def lifespan(app):
        pool = make_pool(settings.database_url, schema)
        pool.open(wait=True, timeout=30)
        app.state.pool = pool
        app.state.classifier = classifier or Classifier()
        try:
            yield
        finally:
            pool.close()

    app = FastAPI(title="상담사 답변 도우미", lifespan=lifespan)

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

    app.include_router(auth.router)
    app.include_router(inquiries.router)
    return app
