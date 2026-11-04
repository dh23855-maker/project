"""질문 - 최종 답변 쌍 보기(qa_pairs) 시험.

보기는 inquiries의 처리 완료 줄을 쌍으로 보여 준다 (복사본이 아님). 임시 DB 영역에서 돌고 실제 데이터는 건드리지 않는다.
"""
import uuid

import psycopg
from psycopg import sql
from psycopg.rows import dict_row

from app.migrate import apply_migrations
from tests.base import COUPON_TEXT, FIRST_DRAFT, SECOND_DRAFT, ApiTestBase, StubClassifier


class QaPairsTest(ApiTestBase):
    @classmethod
    def make_classifier(cls):
        return StubClassifier()

    def setUp(self):
        super().setUp()
        self.classifier.label, self.classifier.confidence = "buyer_cancel_refund", 0.95
        self.set_threshold(70)
        with self.connect() as conn:  # 앞 시험에서 남은 문의가 섞이지 않게 비운다
            conn.execute("DELETE FROM action_logs")
            conn.execute("DELETE FROM inquiries")
            conn.commit()
        self.kim = self.login("kim")
        self.park = self.login("park")

    def create(self, body=COUPON_TEXT, client=None):
        response = (client or self.kim).post("/api/inquiries", json={"body": body})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def act(self, inquiry, name, client=None, **extra):
        response = (client or self.kim).post(
            f"/api/inquiries/{inquiry['id']}/{name}", json={"version": inquiry["version"], **extra}
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def pairs(self):
        with self.connect() as conn:
            return conn.execute("SELECT * FROM qa_pairs ORDER BY inquiry_id").fetchall()

    def test_an_approved_inquiry_becomes_a_pair_with_the_draft_as_the_answer(self):
        inquiry = self.create()
        self.assertEqual(self.pairs(), [])  # 승인하기 전에는 쌍이 아니다
        self.act(inquiry, "approve")
        (pair,) = self.pairs()
        self.assertEqual((pair["inquiry_id"], pair["question"], pair["answer"]), (inquiry["id"], COUPON_TEXT, FIRST_DRAFT))
        self.assertEqual((pair["resolution"], pair["answered_by"], pair["source"]), ("approve", "김상담", "user"))
        self.assertEqual((pair["predicted_label"], pair["rewrite_count"]), ("buyer_cancel_refund", 0))
        self.assertAlmostEqual(pair["confidence"], 0.95, places=2)
        self.assertIsNotNone(pair["answered_at"])
        self.assertIsNotNone(pair["asked_at"])

    def test_an_edited_inquiry_has_the_edited_text_as_the_answer(self):
        inquiry = self.create()
        self.act(inquiry, "edit", text="고친 답장입니다.")
        (pair,) = self.pairs()
        self.assertEqual((pair["answer"], pair["resolution"]), ("고친 답장입니다.", "edit"))

    def test_a_manually_written_inquiry_is_a_pair_marked_manual_write(self):
        self.drafter.mode = "error"
        inquiry = self.create()
        self.assertEqual(inquiry["status"], "manual")
        self.act(inquiry, "manual-reply", text="직접 쓴 답장입니다.")
        (pair,) = self.pairs()
        self.assertEqual((pair["answer"], pair["resolution"]), ("직접 쓴 답장입니다.", "manual_write"))

    def test_rewrite_then_approve_uses_the_second_draft_and_counts_the_rewrite(self):
        inquiry = self.create()
        rewritten = self.act(inquiry, "rewrite")
        self.act(rewritten, "approve")
        (pair,) = self.pairs()
        self.assertEqual((pair["answer"], pair["rewrite_count"], pair["resolution"]), (SECOND_DRAFT, 1, "approve"))

    def test_only_finished_inquiries_are_pairs(self):
        waiting = self.create()
        self.drafter.mode = "error"
        manual = self.create()
        self.drafter.mode = "ok"
        done = self.create()
        self.act(done, "approve")
        self.assertEqual([p["inquiry_id"] for p in self.pairs()], [done["id"]])
        self.assertNotIn(waiting["id"], [p["inquiry_id"] for p in self.pairs()])
        self.assertNotIn(manual["id"], [p["inquiry_id"] for p in self.pairs()])

    def test_editing_again_updates_the_answer_in_place_and_keeps_one_row(self):
        inquiry = self.create()
        approved = self.act(inquiry, "approve")
        self.assertEqual(self.pairs()[0]["resolution"], "approve")
        again = self.act(approved, "edit", client=self.park, text="박상담이 다시 고친 답장")
        (pair,) = self.pairs()  # 줄이 늘지 않는다 (복사본이 아니므로 따로 갱신할 것도 없다)
        self.assertEqual((pair["answer"], pair["resolution"], pair["answered_by"]), ("박상담이 다시 고친 답장", "edit", "박상담"))
        self.act(again, "edit", text="한 번 더")
        (pair,) = self.pairs()
        self.assertEqual((pair["answer"], pair["answered_by"]), ("한 번 더", "김상담"))

    def test_the_pair_always_matches_the_inquiry_it_comes_from(self):
        ids = [self.create(f"{COUPON_TEXT} {n}") for n in range(3)]
        self.act(ids[0], "approve")
        self.act(ids[1], "edit", text="두 번째 답장")
        with self.connect() as conn:
            rows = conn.execute(
                "SELECT i.id, i.body, i.final_reply, p.question, p.answer FROM inquiries i JOIN qa_pairs p ON p.inquiry_id = i.id"
            ).fetchall()
        self.assertEqual(len(rows), 2)
        for row in rows:
            self.assertEqual((row["body"], row["final_reply"]), (row["question"], row["answer"]))

    def test_the_view_cannot_be_used_to_get_around_the_row_level_security(self):
        with self.connect() as conn:
            options = conn.execute(
                "SELECT reloptions FROM pg_class WHERE relname = 'qa_pairs' AND relnamespace = to_regnamespace(current_schema())"
            ).fetchone()["reloptions"]
            self.assertIn("security_invoker=true", options)  # 보는 사람의 권한을 따른다

    def test_roles_supabase_exposes_cannot_read_the_view_even_when_new_tables_are_granted_to_them(self):
        """Supabase는 public 영역에 새로 만든 표·보기를 anon, authenticated에 자동으로 열어 준다. 그 조건을 흉내 내서 확인한다."""
        schema = "test_" + uuid.uuid4().hex[:10]
        with psycopg.connect(self.settings.database_url, row_factory=dict_row, prepare_threshold=None) as conn:
            roles = [
                r for r in ("anon", "authenticated")
                if conn.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (r,)).fetchone()
            ]
            if not roles:
                self.skipTest("이 DB에는 anon, authenticated 역할이 없습니다")
            conn.execute(sql.SQL("CREATE SCHEMA {}").format(sql.Identifier(schema)))
            try:
                for role in roles:
                    conn.execute(
                        sql.SQL("ALTER DEFAULT PRIVILEGES IN SCHEMA {} GRANT ALL ON TABLES TO {}").format(
                            sql.Identifier(schema), sql.Identifier(role)
                        )
                    )
                apply_migrations(conn, schema)
                can = lambda role, name: conn.execute(
                    "SELECT has_table_privilege(%s, %s, 'SELECT') AS ok", (role, f'"{schema}".{name}')
                ).fetchone()["ok"]
                for role in roles:
                    self.assertTrue(can(role, "inquiries"), f"{role}: 흉내 낸 자동 권한이 표에 주어졌어야 한다 (시험 준비 확인)")
                    self.assertFalse(can(role, "qa_pairs"), f"{role}이 qa_pairs를 읽을 수 있다")
            finally:
                conn.rollback()
                conn.execute(sql.SQL("DROP SCHEMA {} CASCADE").format(sql.Identifier(schema)))
                conn.commit()
