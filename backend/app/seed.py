"""처음 데이터 넣기: 상담사 3명과 미리 넣어 둘 가짜 문의 20개.

이미 있는 것은 건너뛰므로 여러 번 실행해도 안전하다.

실행 (backend 폴더에서):
    .venv\\Scripts\\python.exe -m app.seed
"""
import csv

import psycopg
from psycopg.rows import dict_row

from app.classifier import Classifier
from app.config import SEED_DIR, load_settings
from app.inquiries import create_inquiry
from app.security import hash_password

# 연습용 계정입니다. 실제로 쓰는 비밀번호를 여기에 적지 마세요.
PRACTICE_PASSWORD = "practice1234"
AGENTS = [
    ("kim", "김상담"),
    ("park", "박상담"),
    ("lee", "이상담"),
]
INQUIRY_FILE = SEED_DIR / "seed_inquiries.csv"


def seed_agents(conn):
    added = 0
    for username, display_name in AGENTS:
        row = conn.execute(
            "INSERT INTO agents (username, display_name, password_hash) VALUES (%s, %s, %s)"
            " ON CONFLICT (username) DO NOTHING RETURNING id",
            (username, display_name, hash_password(PRACTICE_PASSWORD)),
        ).fetchone()
        added += row is not None
    return added


def read_seed_texts(path=INQUIRY_FILE):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [row["text"].strip() for row in csv.DictReader(f) if row["text"].strip()]


def seed_inquiries(conn, classifier, path=INQUIRY_FILE):
    added = 0
    for text in read_seed_texts(path):
        exists = conn.execute(
            "SELECT 1 FROM inquiries WHERE source = 'seed' AND body = %s", (text,)
        ).fetchone()
        if exists:
            continue
        create_inquiry(conn, classifier, text, agent_id=None, source="seed")
        added += 1
    return added


if __name__ == "__main__":
    settings = load_settings()
    classifier = Classifier()
    with psycopg.connect(settings.database_url, row_factory=dict_row, prepare_threshold=None) as conn:
        agents_added = seed_agents(conn)
        inquiries_added = seed_inquiries(conn, classifier)
        conn.commit()
    print(f"상담사 {agents_added}명, 가짜 문의 {inquiries_added}개를 새로 넣었습니다.")
