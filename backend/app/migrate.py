"""DB 표 만들기: database/schema 폴더의 .sql 파일을 번호 순서대로 적용한다.

이미 적용한 파일은 건너뛰므로 여러 번 실행해도 안전하다.

실행 (backend 폴더에서):
    .venv\\Scripts\\python.exe -m app.migrate
"""
import psycopg
from psycopg import sql

from app.config import SCHEMA_DIR, load_settings


def apply_migrations(conn, schema=None):
    """적용한 파일 이름 목록을 돌려준다. schema를 주면 그 영역에 만든다(시험용)."""
    if schema:
        conn.execute(sql.SQL("CREATE SCHEMA IF NOT EXISTS {}").format(sql.Identifier(schema)))
        conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))

    conn.execute(
        "CREATE TABLE IF NOT EXISTS schema_migrations ("
        " name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
    )
    conn.execute("ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY")
    done = {row[0] for row in conn.execute("SELECT name FROM schema_migrations")}

    applied = []
    for path in sorted(SCHEMA_DIR.glob("*.sql")):
        if path.name in done:
            continue
        conn.execute(path.read_text(encoding="utf-8"))
        conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
        applied.append(path.name)
    conn.commit()
    return applied


if __name__ == "__main__":
    settings = load_settings()
    with psycopg.connect(settings.database_url, prepare_threshold=None) as conn:
        applied = apply_migrations(conn)
    print("적용한 파일:", ", ".join(applied) if applied else "없음 (이미 최신입니다)")
