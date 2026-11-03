"""DB·서버 시험의 공통 준비물.

- 임시 영역(test_로 시작하는 schema)에 표를 새로 만들어 쓰고, 끝나면 지운다. 실제 데이터는 건드리지 않는다.
- 초안은 OpenAI 대신 FakeDrafter가 만든다 (돈이 들지 않고 결과가 매번 같다).
"""
import unittest
import uuid

import psycopg
from fastapi.testclient import TestClient
from psycopg import sql
from psycopg.rows import dict_row

from app.classifier import Classifier
from app.config import load_settings
from app.drafting import NO_COVERAGE_NOTE, DraftError, DraftResult
from app.main import create_app
from app.migrate import apply_migrations
from app.policy import PolicyBook
from app.seed import PRACTICE_PASSWORD, seed_agents, seed_inquiries, seed_risky_phrases
from ml.train import model_path, train

COUPON_TEXT = "쿠폰 쓴 주문을 취소하면 쿠폰은 돌려받나요?"  # 취소·환불 문의, RFD-04와 매우 비슷
FIRST_DRAFT = "안녕하세요, 고객님. (첫 초안) 문의하신 내용을 확인했습니다. 감사합니다."
SECOND_DRAFT = "안녕하세요, 고객님. (재작성한 초안) 정책에 따라 안내드립니다. 감사합니다."
PARTIAL_NOTE = "입금 예정일은 규정 문서에 없습니다."


class FakeDrafter:
    """OpenAI 대신 쓰는 가짜 초안 작성기. mode로 여러 상황을 흉내 낸다."""

    def __init__(self):
        self.mode = "ok"  # ok / error / no_coverage / partial / bad_id / not_provided
        self.text = None  # 직접 정하면 이 글을 초안으로 쓴다
        self.cite = None  # 함수(clauses) -> 조항 번호 튜플. 없으면 첫 조항
        self.calls = []

    def draft(self, inquiry_text, clauses, avoid=None):
        self.calls.append({"text": inquiry_text, "clauses": [c.id for c in clauses], "avoid": avoid})
        if self.mode == "error":
            raise DraftError("가짜 오류")
        if self.mode == "no_coverage":  # 조항을 하나도 쓰지 않은 초안
            return DraftResult(FIRST_DRAFT, (), NO_COVERAGE_NOTE)
        if self.mode == "bad_id":
            return DraftResult(FIRST_DRAFT, ("ZZZ-99",))
        if self.mode == "not_provided":
            outside = "GEN-05" if "GEN-05" not in [c.id for c in clauses] else "STO-01"
            return DraftResult(FIRST_DRAFT, (outside,))
        text = self.text or (SECOND_DRAFT if avoid else FIRST_DRAFT)
        if not clauses:  # 실제 모델처럼, 조항이 없으면 근거 없이 쓴다
            return DraftResult(text, (), NO_COVERAGE_NOTE)
        cited = self.cite(clauses) if self.cite else (clauses[0].id,)
        uncovered = PARTIAL_NOTE if self.mode == "partial" else ""
        return DraftResult(text, tuple(cited), uncovered)


class StubClassifier:
    """정해 둔 종류와 확신도를 그대로 돌려주는 가짜 분류기."""

    def __init__(self, label="buyer_cancel_refund", confidence=0.95):
        self.label = label
        self.confidence = confidence

    def classify(self, text):
        return self.label, self.confidence


class ApiTestBase(unittest.TestCase):
    @classmethod
    def make_classifier(cls):
        return Classifier()

    @classmethod
    def setUpClass(cls):
        if not model_path().exists():
            train()
        cls.settings = load_settings()
        cls.schema = "test_" + uuid.uuid4().hex[:10]
        cls.classifier = cls.make_classifier()
        cls.policy = PolicyBook()
        cls.drafter = FakeDrafter()

        with psycopg.connect(cls.settings.database_url, prepare_threshold=None) as conn:
            apply_migrations(conn, cls.schema)
        with cls.connect() as conn:
            seed_agents(conn)
            seed_risky_phrases(conn)
            seed_inquiries(conn, Classifier(), cls.policy, cls.drafter)
            conn.commit()
        cls.drafter.calls.clear()

        cls.app = create_app(
            schema=cls.schema, classifier=cls.classifier, policy=cls.policy, drafter=cls.drafter
        )
        cls._lifespan = TestClient(cls.app)
        cls._lifespan.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls._lifespan.__exit__(None, None, None)
        with psycopg.connect(cls.settings.database_url, prepare_threshold=None) as conn:
            conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(cls.schema)))
            conn.commit()

    @classmethod
    def connect(cls):
        conn = psycopg.connect(cls.settings.database_url, row_factory=dict_row, prepare_threshold=None)
        conn.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(cls.schema)))
        return conn

    def new_client(self):
        return TestClient(self.app)

    def login(self, username="kim", password=PRACTICE_PASSWORD):
        client = self.new_client()
        response = client.post("/api/auth/login", json={"username": username, "password": password})
        self.assertEqual(response.status_code, 200, response.text)
        return client

    def set_threshold(self, value):
        with self.connect() as conn:
            conn.execute("UPDATE settings SET value = %s WHERE key = 'confidence_threshold'", (str(value),))
            conn.commit()

    def setUp(self):
        # 시험마다 가짜 장치를 처음 상태로 돌린다
        self.drafter.mode, self.drafter.text, self.drafter.cite = "ok", None, None
        self.drafter.calls.clear()
