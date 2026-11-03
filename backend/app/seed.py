"""처음 데이터 넣기: 상담사 3명, 위험 표현 20개, 미리 넣어 둘 가짜 문의 20개.

이미 있는 것은 건너뛰므로 여러 번 실행해도 안전하다.
초안이 없는 '승인 대기' 문의가 있으면 초안을 붙인다 (OpenAI를 부른다).

실행 (backend 폴더에서):
    .venv\\Scripts\\python.exe -m app.seed             # 없는 것만 넣기
    .venv\\Scripts\\python.exe -m app.seed --reset     # 가짜 문의 20개를 지우고 새 모델·정책으로 다시 넣기
"""
import csv
import sys

import psycopg
from psycopg.rows import dict_row

from app.classifier import Classifier
from app.config import SEED_DIR, load_settings
from app.drafting import OpenAIDrafter
from app.inquiries import backfill_drafts, create_inquiry
from app.policy import make_policy
from app.security import hash_password

# 연습용 계정입니다. 실제로 쓰는 비밀번호를 여기에 적지 마세요.
PRACTICE_PASSWORD = "practice1234"
AGENTS = [
    ("kim", "김상담"),
    ("park", "박상담"),
    ("lee", "이상담"),
]
INQUIRY_FILE = SEED_DIR / "seed_inquiries.csv"
PHRASE_FILE = SEED_DIR / "risky_phrases.csv"


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


def read_column(path, column):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return [row[column].strip() for row in csv.DictReader(f) if row[column].strip()]


def read_seed_texts(path=INQUIRY_FILE):
    return read_column(path, "text")


def read_seed_phrases(path=PHRASE_FILE):
    return read_column(path, "phrase")


def seed_risky_phrases(conn, path=PHRASE_FILE):
    added = 0
    for phrase in read_seed_phrases(path):
        row = conn.execute(
            "INSERT INTO risky_phrases (phrase) VALUES (%s) ON CONFLICT DO NOTHING RETURNING id",
            (phrase,),
        ).fetchone()
        added += row is not None
    return added


class ResetRefused(RuntimeError):
    """상담사가 이미 처리한 시드 문의가 있어서 다시 넣기를 거절할 때."""


def reset_seed_inquiries(conn):
    """미리 넣어 둔 가짜 문의(source='seed')를 지운다. 분류 모델을 바꾼 뒤 상태를 새로 잡을 때 쓴다.

    상담사가 처리한 기록(작업 기록)이 있거나 이미 '처리 완료'가 된 시드 문의가 하나라도 있으면
    아무것도 지우지 않고 거절한다. 상담사가 입력한 문의(source='user')는 건드리지 않는다.
    """
    touched = conn.execute(
        "SELECT i.id FROM inquiries i WHERE i.source = 'seed' AND (i.status = 'done' OR EXISTS"
        " (SELECT 1 FROM action_logs l WHERE l.inquiry_id = i.id)) ORDER BY i.id"
    ).fetchall()
    if touched:
        ids = [r["id"] for r in touched]
        raise ResetRefused(f"상담사가 이미 처리한 시드 문의가 있어 지우지 않습니다: {ids}")
    return conn.execute("DELETE FROM inquiries WHERE source = 'seed'").rowcount


def seed_inquiries(conn, classifier, policy, drafter, path=INQUIRY_FILE):
    added = 0
    for text in read_seed_texts(path):
        exists = conn.execute(
            "SELECT 1 FROM inquiries WHERE source = 'seed' AND body = %s", (text,)
        ).fetchone()
        if exists:
            continue
        create_inquiry(conn, classifier, policy, drafter, text, agent_id=None, source="seed")
        added += 1
    return added


if __name__ == "__main__":
    settings = load_settings()
    classifier = Classifier()
    policy = make_policy(settings)
    drafter = OpenAIDrafter(settings.openai_api_key, settings.openai_model)
    with psycopg.connect(settings.database_url, row_factory=dict_row, prepare_threshold=None) as conn:
        if "--reset" in sys.argv[1:]:
            try:
                removed = reset_seed_inquiries(conn)
            except ResetRefused as e:
                conn.rollback()
                sys.exit(str(e))
            conn.commit()
            print(f"미리 넣어 둔 가짜 문의 {removed}개를 지우고 다시 넣습니다.")
        agents_added = seed_agents(conn)
        phrases_added = seed_risky_phrases(conn)
        conn.commit()
        inquiries_added = seed_inquiries(conn, classifier, policy, drafter)
        conn.commit()
        attached, moved = backfill_drafts(conn, policy, drafter)
        conn.commit()
    print(f"상담사 {agents_added}명, 위험 표현 {phrases_added}개, 가짜 문의 {inquiries_added}개를 새로 넣었습니다.")
    print(f"기존 승인 대기 문의: 초안 {attached}개 붙임, 직접 작성으로 보낸 것 {moved}개")
