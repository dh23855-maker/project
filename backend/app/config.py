"""환경 설정(.env)을 읽는다."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

PROJECT_DIR = Path(__file__).resolve().parents[2]
SCHEMA_DIR = PROJECT_DIR / "database" / "schema"
SEED_DIR = PROJECT_DIR / "database" / "seed"

load_dotenv(PROJECT_DIR / ".env")


@dataclass(frozen=True)
class Settings:
    database_url: str
    session_secret: str
    frontend_origin: str
    openai_api_key: str = ""
    openai_model: str = ""
    openai_embedding_model: str = ""


def load_settings():
    missing = [k for k in ("DATABASE_URL", "SESSION_SECRET") if not os.environ.get(k)]
    if missing:
        raise RuntimeError(f".env에 값이 없습니다: {', '.join(missing)}")
    return Settings(
        database_url=os.environ["DATABASE_URL"],
        session_secret=os.environ["SESSION_SECRET"],
        frontend_origin=os.environ.get("FRONTEND_ORIGIN", "http://localhost:5173"),
        openai_api_key=os.environ.get("OPENAI_API_KEY", ""),
        openai_model=os.environ.get("OPENAI_MODEL", ""),
        openai_embedding_model=os.environ.get("OPENAI_EMBEDDING_MODEL", ""),
    )
