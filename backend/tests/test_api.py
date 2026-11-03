"""Phase 2 시험: 로그인, 문의 등록·조회, 자동 분류 연결, DB 표 설계.

실제 데이터를 건드리지 않도록 임시 영역(test_로 시작하는 schema)에 표를 새로 만들어 시험하고,
끝나면 그 영역을 지운다.

실행 (backend 폴더에서):
    .venv\\Scripts\\python.exe -m unittest discover -s tests -t . -v
"""
import unittest

import psycopg

from app import inquiries as service
from app.migrate import apply_migrations
from app.seed import AGENTS, PRACTICE_PASSWORD, read_seed_texts, seed_agents, seed_inquiries
from ml.data import load_training_rows
from tests.base import ApiTestBase

BAD_CREDENTIALS = "아이디 또는 비밀번호가 맞지 않습니다."
NOT_LOGGED_IN = "로그인이 필요합니다."



class LowConfidenceTest(unittest.TestCase):
    def test_below_threshold_is_low(self):
        self.assertTrue(service.is_low_confidence(0.699, 70))
        self.assertTrue(service.is_low_confidence(0.2, 70))

    def test_at_or_above_threshold_is_not_low(self):
        self.assertFalse(service.is_low_confidence(0.70, 70))
        self.assertFalse(service.is_low_confidence(0.95, 70))

    def test_float_rounding_edge(self):
        # 0.29 * 100 은 28.999999999999996 이 되는데, 29% 기준값이면 낮은 것이 아니다.
        self.assertFalse(service.is_low_confidence(0.29, 29))


class ValidateBodyTest(unittest.TestCase):
    def test_strips_spaces(self):
        self.assertEqual(service.validate_body("  택배 언제 와요  "), "택배 언제 와요")

    def test_empty_values(self):
        for raw in (None, "", "   ", "\n\t"):
            with self.assertRaisesRegex(service.InvalidInquiry, "입력하세요"):
                service.validate_body(raw)

    def test_length_limit(self):
        self.assertEqual(len(service.validate_body("가" * 1000)), 1000)
        with self.assertRaisesRegex(service.InvalidInquiry, "1001자"):
            service.validate_body("가" * 1001)


class SeedDataTest(unittest.TestCase):
    def test_seed_file_has_20_and_is_separate_from_train_and_eval(self):
        texts = read_seed_texts()
        self.assertEqual(len(texts), 20)
        self.assertEqual(len(set(texts)), 20)
        train_texts = {r["text"] for r in load_training_rows()}
        self.assertEqual(train_texts & set(texts), set())


class ApiTest(ApiTestBase):
    """로그인, 문의 목록·등록, DB 표 설계."""

    # --- DB 표 설계 -------------------------------------------------------

    def test_migrations_are_idempotent(self):
        with psycopg.connect(self.settings.database_url, prepare_threshold=None) as conn:
            self.assertEqual(apply_migrations(conn, self.schema), [])

    def test_row_level_security_is_on_for_every_table(self):
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT c.relname, c.relrowsecurity FROM pg_class c"
                " JOIN pg_namespace n ON n.oid = c.relnamespace"
                " WHERE n.nspname = %s AND c.relkind = 'r'",
                (self.schema,),
            ).fetchall()
        names = {r["relname"] for r in rows}
        for table in ("agents", "inquiries", "drafts", "action_logs", "risky_phrases", "settings", "eval_runs"):
            self.assertIn(table, names)
        off = [r["relname"] for r in rows if not r["relrowsecurity"]]
        self.assertEqual(off, [], f"접근 제한(RLS)이 꺼진 표: {off}")

    def test_default_threshold_is_70(self):
        with self.connect() as conn:
            self.assertEqual(service.get_threshold(conn), 70)

    # --- 처음 데이터 ------------------------------------------------------

    def test_seed_agents_and_inquiries(self):
        with self.connect() as conn:
            agents = conn.execute("SELECT username, display_name FROM agents ORDER BY username").fetchall()
            self.assertEqual(
                [(a["username"], a["display_name"]) for a in agents],
                sorted(AGENTS),
            )
            n = conn.execute("SELECT count(*) AS n FROM inquiries WHERE source = 'seed'").fetchone()["n"]
            self.assertEqual(n, 20)

    def test_seeding_twice_adds_nothing(self):
        with self.connect() as conn:
            self.assertEqual(seed_agents(conn), 0)
            self.assertEqual(seed_inquiries(conn, self.classifier, self.policy, self.drafter), 0)
            conn.rollback()

    def test_passwords_are_not_stored_in_plain_text(self):
        with self.connect() as conn:
            for row in conn.execute("SELECT password_hash FROM agents").fetchall():
                self.assertNotEqual(row["password_hash"], PRACTICE_PASSWORD)
                self.assertTrue(row["password_hash"].startswith("$2"))

    # --- 로그인 ------------------------------------------------------------

    def test_each_account_can_log_in(self):
        for username, display_name in AGENTS:
            client = self.new_client()
            response = client.post(
                "/api/auth/login", json={"username": username, "password": PRACTICE_PASSWORD}
            )
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()["agent"]["display_name"], display_name)
            me = client.get("/api/auth/me")
            self.assertEqual(me.status_code, 200)
            self.assertEqual(me.json()["username"], username)

    def test_login_cookie_ends_when_browser_closes(self):
        client = self.new_client()
        response = client.post("/api/auth/login", json={"username": "kim", "password": PRACTICE_PASSWORD})
        cookie = response.headers["set-cookie"].lower()
        self.assertIn("session=", cookie)
        self.assertNotIn("max-age", cookie)
        self.assertNotIn("expires", cookie)

    def test_wrong_password_and_unknown_user_look_the_same(self):
        client = self.new_client()
        wrong_pw = client.post("/api/auth/login", json={"username": "kim", "password": "nope"})
        unknown = client.post("/api/auth/login", json={"username": "nobody", "password": "nope"})
        for response in (wrong_pw, unknown):
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json()["detail"], BAD_CREDENTIALS)
        self.assertEqual(client.get("/api/auth/me").status_code, 401)

    def test_empty_login_fields_are_rejected(self):
        client = self.new_client()
        for payload in (
            {"username": "", "password": ""},
            {"username": "kim", "password": ""},
            {"username": "   ", "password": PRACTICE_PASSWORD},
            {},
            {"username": None, "password": None},
        ):
            response = client.post("/api/auth/login", json=payload)
            self.assertEqual(response.status_code, 400, payload)
            self.assertEqual(response.json()["detail"], "아이디와 비밀번호를 입력하세요.")

    def test_logout_ends_the_session(self):
        client = self.login()
        self.assertEqual(client.get("/api/inquiries").status_code, 200)
        self.assertEqual(client.post("/api/auth/logout").status_code, 204)
        self.assertEqual(client.get("/api/auth/me").status_code, 401)
        self.assertEqual(client.get("/api/inquiries").status_code, 401)

    def test_everything_needs_login(self):
        client = self.new_client()
        calls = [
            client.get("/api/auth/me"),
            client.get("/api/inquiries"),
            client.get("/api/inquiries/1"),
            client.post("/api/inquiries", json={"body": "택배 언제 와요"}),
        ]
        for response in calls:
            self.assertEqual(response.status_code, 401)
            self.assertEqual(response.json()["detail"], NOT_LOGGED_IN)

    # --- 문의 목록과 새 문의 ---------------------------------------------

    def test_list_shows_the_20_seed_inquiries_newest_first(self):
        items = self.login().get("/api/inquiries").json()
        self.assertGreaterEqual(len(items), 20)
        self.assertEqual(sum(1 for i in items if i["source"] == "seed"), 20)
        ids = [i["id"] for i in items]
        self.assertEqual(ids, sorted(ids, reverse=True))
        for item in items:
            self.assertIn(item["status_ko"], ("승인 대기", "직접 작성", "처리 완료"))

    def test_seed_statuses_follow_the_rules(self):
        client = self.login()
        items = [i for i in client.get("/api/inquiries").json() if i["source"] == "seed"]
        for item in items:
            self.assertIsNotNone(item["predicted_label_ko"])
            # 모든 문의에 초안이 붙어 승인 대기가 된다. 확신도가 낮으면 경고 문구만 더 붙는다.
            self.assertEqual(item["status"], "awaiting_approval", item["body"])
            if item["confidence_percent"] < 70:
                self.assertEqual(item["auto_note"], service.low_confidence_note(70), item["body"])
            else:
                self.assertIsNone(item["auto_note"], item["body"])
            detail = client.get(f"/api/inquiries/{item['id']}").json()
            self.assertIsNotNone(detail["current_draft"], item["body"])
            # 규정 문서가 없는 초안에는 반드시 '규정 문서에는 없음' 메모가 있다
            if not detail["current_draft"]["cited"]:
                self.assertTrue(detail["current_draft"]["uncovered_note"], item["body"])
        self.assertTrue(any(i["auto_note"] for i in items), "확신도가 낮은 문의가 시연에 있어야 합니다")

    def test_create_inquiry_classifies_and_every_agent_can_see_it(self):
        kim = self.login("kim")
        response = kim.post("/api/inquiries", json={"body": "  택배 배송이 아직 안 왔어요 송장 조회가 안 돼요  "})
        self.assertEqual(response.status_code, 201, response.text)
        created = response.json()
        self.assertEqual(created["body"], "택배 배송이 아직 안 왔어요 송장 조회가 안 돼요")
        self.assertEqual(created["predicted_label"], "buyer_delivery")
        self.assertEqual(created["predicted_label_ko"], "배송")
        self.assertEqual(created["asker"], "구매자")
        self.assertGreater(created["confidence_percent"], 0)
        self.assertEqual(created["source"], "user")
        self.assertEqual(created["created_by_name"], "김상담")
        self.assertEqual(created["status"], "awaiting_approval")

        # 다른 상담사에게도 보인다
        park = self.login("park")
        seen = park.get(f"/api/inquiries/{created['id']}")
        self.assertEqual(seen.status_code, 200)
        self.assertEqual(seen.json()["body"], created["body"])
        self.assertIn(created["id"], [i["id"] for i in park.get("/api/inquiries").json()])
        # 새 문의가 목록 맨 위에 온다
        self.assertEqual(kim.get("/api/inquiries").json()[0]["id"], created["id"])

    def test_empty_inquiry_is_rejected(self):
        client = self.login()
        for payload in ({"body": ""}, {"body": "   \n "}, {}, {"body": None}):
            response = client.post("/api/inquiries", json=payload)
            self.assertEqual(response.status_code, 400, payload)
            self.assertEqual(response.json()["detail"], "문의 내용을 입력하세요.")

    def test_inquiry_length_limit(self):
        client = self.login()
        ok = client.post("/api/inquiries", json={"body": "가" * 1000})
        self.assertEqual(ok.status_code, 201)
        too_long = client.post("/api/inquiries", json={"body": "가" * 1001})
        self.assertEqual(too_long.status_code, 400)
        self.assertIn("1000자까지", too_long.json()["detail"])
        self.assertIn("1001자", too_long.json()["detail"])

    def test_unknown_inquiry_is_404(self):
        self.assertEqual(self.login().get("/api/inquiries/99999999").status_code, 404)

    def test_threshold_only_decides_the_warning_not_the_status(self):
        body = "출고 알림이 왔는데 택배 송장 조회가 안 돼요 배송 조회가 언제부터 되나요"
        client = self.login()
        try:
            self.set_threshold(100)  # 확신도가 100%일 수는 없으므로 모두 '확신도 낮음'
            high = client.post("/api/inquiries", json={"body": body}).json()
            self.assertEqual(high["status"], "awaiting_approval", high["auto_note"])  # 그래도 초안을 쓴다
            self.assertEqual(high["auto_note"], service.low_confidence_note(100))
            self.assertIsNotNone(high["current_draft"])
            self.set_threshold(0)  # 확신도 조건은 모두 통과. 경고 없음
            low = client.post("/api/inquiries", json={"body": body}).json()
            self.assertEqual(low["predicted_label"], "buyer_delivery")
            self.assertEqual(low["status"], "awaiting_approval", low["auto_note"])
            self.assertIsNone(low["auto_note"])
        finally:
            self.set_threshold(70)

    def test_classifier_failure_still_saves_the_inquiry_with_a_draft(self):
        class Broken:
            def classify(self, text):
                raise RuntimeError("모델 오류")

        original = self.app.state.classifier
        self.app.state.classifier = Broken()
        try:
            with self.assertLogs("app.inquiries", level="ERROR"):
                response = self.login().post("/api/inquiries", json={"body": "정산이 언제 되나요"})
        finally:
            self.app.state.classifier = original
        self.assertEqual(response.status_code, 201)
        created = response.json()
        self.assertEqual(created["status"], "awaiting_approval")  # 분류를 못 해도 초안은 쓴다
        self.assertIsNotNone(created["current_draft"])
        self.assertIsNone(created["predicted_label"])
        self.assertIsNone(created["confidence_percent"])
        self.assertEqual(created["auto_note"], service.CLASSIFY_FAIL_NOTE)
        self.assertEqual(self.login("lee").get(f"/api/inquiries/{created['id']}").status_code, 200)


if __name__ == "__main__":
    unittest.main()
