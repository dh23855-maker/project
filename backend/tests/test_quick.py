"""빠른 승인과 비슷한 지난 문의 시험.

- 빠른 승인 조건: 확신도 90% 초과, 규정 문서를 하나라도 참고, 위험 표현 경고 없음 (승인 대기 문의만)
- [빠른 승인]: 목록에서 본 문의들을 초안 그대로 한 번에 승인하고, 건너뛰는 문의는 이유를 알려 준다
- 비슷한 지난 문의: 처리 완료된 문의 중 비슷한 것과 그 최종 답장 (임베딩, 안 되면 TF-IDF)
"""
from app.drafting import NO_COVERAGE_NOTE
from app.similar import EMBEDDING_MIN_SIMILARITY, SimilarFinder
from tests.base import COUPON_TEXT, FIRST_DRAFT, PARTIAL_NOTE, ApiTestBase, StubClassifier
from tests.test_policy import FakeEmbedder


class QuickBase(ApiTestBase):
    @classmethod
    def make_classifier(cls):
        return StubClassifier()

    def setUp(self):
        super().setUp()
        self.classifier.label = "buyer_cancel_refund"
        self.classifier.confidence = 0.95
        self.set_threshold(70)
        with self.connect() as conn:  # 앞 시험에서 남은 문의가 이번 시험의 "비슷한 문의" 등에 섞이지 않게 비운다
            conn.execute("DELETE FROM action_logs")
            conn.execute("DELETE FROM inquiries")
            conn.commit()
        self.kim = self.login("kim")

    def create(self, body=COUPON_TEXT, confidence=None, client=None):
        if confidence is not None:
            self.classifier.confidence = confidence
        response = (client or self.kim).post("/api/inquiries", json={"body": body})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def listed(self, inquiry_id, client=None):
        rows = (client or self.kim).get("/api/inquiries").json()
        return next(r for r in rows if r["id"] == inquiry_id)

    def risky_phrase(self):
        with self.connect() as conn:
            return conn.execute("SELECT phrase FROM risky_phrases ORDER BY id LIMIT 1").fetchone()["phrase"]


class QuickApprovableTest(QuickBase):
    def test_a_confident_cited_clean_draft_is_quick_approvable(self):
        inquiry = self.create()
        self.assertTrue(inquiry["quick_approvable"])
        self.assertTrue(self.listed(inquiry["id"])["quick_approvable"])
        self.assertTrue(self.kim.get(f"/api/inquiries/{inquiry['id']}").json()["quick_approvable"])

    def test_confidence_must_be_over_90_percent(self):
        for confidence, expected in ((0.89, False), (0.90, False), (0.901, True), (0.97, True)):
            with self.subTest(confidence=confidence):
                inquiry = self.create(confidence=confidence)
                self.assertEqual(self.listed(inquiry["id"])["quick_approvable"], expected)

    def test_the_90_percent_line_is_fixed_and_ignores_the_settings_threshold(self):
        self.set_threshold(50)  # 설정 기준값을 낮춰도 빠른 승인 기준은 90%다
        inquiry = self.create(confidence=0.85)
        self.assertFalse(self.listed(inquiry["id"])["quick_approvable"])

    def test_a_draft_that_cited_no_clause_is_not_quick_approvable(self):
        self.drafter.mode = "no_coverage"
        inquiry = self.create()
        self.assertEqual(inquiry["current_draft"]["uncovered_note"], NO_COVERAGE_NOTE)
        self.assertFalse(self.listed(inquiry["id"])["quick_approvable"])

    def test_a_partly_covered_draft_is_still_quick_approvable(self):
        """규정 문서를 하나라도 참고했으면 "없음"이 아니다. 일부 없음 메모는 기준에 영향을 주지 않는다."""
        self.drafter.mode = "partial"
        inquiry = self.create()
        self.assertIsNone(inquiry["current_draft"]["uncovered_note"])
        self.assertTrue(self.listed(inquiry["id"])["quick_approvable"])

    def test_a_draft_with_a_risky_phrase_is_not_quick_approvable(self):
        self.drafter.text = f"안녕하세요, 고객님. {self.risky_phrase()}. 감사합니다."
        inquiry = self.create()
        self.assertTrue(inquiry["risk_warnings"])
        self.assertFalse(self.listed(inquiry["id"])["quick_approvable"])

    def test_adding_a_risky_phrase_later_takes_the_inquiry_out(self):
        def remove_phrase():
            with self.connect() as conn:
                conn.execute("DELETE FROM risky_phrases WHERE phrase = '첫 초안'")
                conn.commit()

        self.addCleanup(remove_phrase)  # 다른 시험에 남지 않게
        inquiry = self.create()
        self.assertTrue(self.listed(inquiry["id"])["quick_approvable"])
        self.assertEqual(self.kim.post("/api/risky-phrases", json={"phrase": "첫 초안"}).status_code, 201)  # FIRST_DRAFT 안에 있는 말
        self.assertFalse(self.listed(inquiry["id"])["quick_approvable"])

    def test_only_awaiting_approval_inquiries_can_be_quick_approvable(self):
        approved = self.create()
        self.kim.post(f"/api/inquiries/{approved['id']}/approve", json={"version": approved["version"]})
        self.assertFalse(self.listed(approved["id"])["quick_approvable"])  # 처리 완료
        self.drafter.mode = "error"
        failed = self.create()
        self.assertEqual(failed["status"], "manual")
        self.assertFalse(failed["quick_approvable"])  # 직접 작성

    def test_unclassified_inquiry_is_not_quick_approvable(self):
        inquiry = self.create()
        with self.connect() as conn:
            conn.execute("UPDATE inquiries SET confidence = NULL, predicted_label = NULL WHERE id = %s", (inquiry["id"],))
            conn.commit()
        self.assertFalse(self.listed(inquiry["id"])["quick_approvable"])

    def test_the_latest_draft_decides(self):
        inquiry = self.create()
        self.assertTrue(inquiry["quick_approvable"])
        self.drafter.mode = "no_coverage"  # 재작성한 두 번째 초안이 규정 문서를 쓰지 못했다
        rewritten = self.kim.post(
            f"/api/inquiries/{inquiry['id']}/rewrite", json={"version": inquiry["version"]}
        ).json()
        self.assertEqual(rewritten["current_draft"]["cited"], [])
        self.assertFalse(self.listed(inquiry["id"])["quick_approvable"])


class QuickApproveTest(QuickBase):
    def quick(self, *inquiries, client=None, versions=None):
        items = [
            {"id": q["id"], "version": (versions or {}).get(q["id"], q["version"])} for q in inquiries
        ]
        return (client or self.kim).post("/api/inquiries/quick-approve", json={"items": items})

    def logs(self, inquiry_id):
        return [r for r in self.kim.get("/api/action-logs").json() if r["inquiry_id"] == inquiry_id]

    def test_approves_all_given_inquiries_with_the_draft_as_is(self):
        a, b = self.create(), self.create()
        outsider = self.create()  # 목록에 넣지 않은 문의는 그대로다
        response = self.quick(a, b)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json(), {"approved": [a["id"], b["id"]], "skipped": []})
        for inquiry in (a, b):
            detail = self.kim.get(f"/api/inquiries/{inquiry['id']}").json()
            self.assertEqual(detail["status"], "done")
            self.assertEqual(detail["final_reply"], FIRST_DRAFT)
            self.assertEqual(detail["resolved_by_name"], "김상담")
        self.assertEqual(self.kim.get(f"/api/inquiries/{outsider['id']}").json()["status"], "awaiting_approval")

    def test_each_approval_is_logged_like_the_approve_button(self):
        a = self.create()
        self.quick(a)
        logs = self.logs(a["id"])
        self.assertEqual([(r["action"], r["agent_username"]) for r in logs], [("approve", "kim")])
        self.assertEqual((logs[0]["draft_text"], logs[0]["final_reply"]), (FIRST_DRAFT, FIRST_DRAFT))

    def test_an_inquiry_that_no_longer_qualifies_is_skipped_with_a_reason_and_the_rest_go_on(self):
        a, b, c = self.create(), self.create(), self.create()
        with self.connect() as conn:  # 목록을 본 뒤 b의 확신도가 떨어졌다고 하자
            conn.execute("UPDATE inquiries SET confidence = 0.5 WHERE id = %s", (b["id"],))
            conn.commit()
        body = self.quick(a, b, c).json()
        self.assertEqual(body["approved"], [a["id"], c["id"]])  # b 뒤의 c도 승인된다
        self.assertEqual([s["id"] for s in body["skipped"]], [b["id"]])
        self.assertIn("조건", body["skipped"][0]["reason"])
        self.assertEqual(self.kim.get(f"/api/inquiries/{b['id']}").json()["status"], "awaiting_approval")
        self.assertEqual(self.logs(b["id"]), [])  # 건너뛴 문의에는 기록이 남지 않는다

    def test_the_server_enforces_the_rule_even_if_the_screen_sends_an_ineligible_inquiry(self):
        low = self.create(confidence=0.80)
        self.drafter.mode = "no_coverage"
        uncovered = self.create(confidence=0.95)
        self.drafter.mode = "ok"
        risky_text = f"안녕하세요. {self.risky_phrase()}. 감사합니다."
        self.drafter.text = risky_text
        risky = self.create()
        body = self.quick(low, uncovered, risky).json()
        self.assertEqual(body["approved"], [])
        self.assertEqual(sorted(s["id"] for s in body["skipped"]), sorted([low["id"], uncovered["id"], risky["id"]]))
        for item in (low, uncovered, risky):
            self.assertEqual(self.kim.get(f"/api/inquiries/{item['id']}").json()["status"], "awaiting_approval")

    def test_an_inquiry_someone_else_already_handled_is_skipped(self):
        a, b = self.create(), self.create()
        park = self.login("park")
        self.assertEqual(park.post(f"/api/inquiries/{a['id']}/approve", json={"version": a["version"]}).status_code, 200)
        body = self.quick(a, b).json()
        self.assertEqual(body["approved"], [b["id"]])
        self.assertEqual([s["id"] for s in body["skipped"]], [a["id"]])
        self.assertIn("다른 상담사", body["skipped"][0]["reason"])
        self.assertEqual(len(self.logs(a["id"])), 1)  # 박상담이 한 승인 하나뿐이다
        self.assertEqual(self.logs(a["id"])[0]["agent_username"], "park")

    def test_an_inquiry_already_handled_is_skipped_with_that_reason_even_with_the_latest_version(self):
        a = self.create()
        done = self.kim.post(f"/api/inquiries/{a['id']}/approve", json={"version": a["version"]}).json()
        body = self.quick(done).json()  # 처리된 뒤의 최신 version으로 보내도
        self.assertEqual(body["approved"], [])
        self.assertEqual(body["skipped"], [{"id": a["id"], "reason": "이미 처리된 문의입니다."}])
        self.assertEqual(len(self.logs(a["id"])), 1)  # 승인 기록이 하나 더 쌓이지 않는다

    def test_a_stale_version_is_skipped(self):
        a = self.create()
        body = self.quick(a, versions={a["id"]: a["version"] + 5}).json()
        self.assertEqual(body["approved"], [])
        self.assertIn("다른 상담사", body["skipped"][0]["reason"])

    def test_unknown_id_is_skipped_not_an_error(self):
        a = self.create()
        response = self.kim.post(
            "/api/inquiries/quick-approve",
            json={"items": [{"id": 99999999, "version": 0}, {"id": a["id"], "version": a["version"]}]},
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["approved"], [a["id"]])
        self.assertEqual(response.json()["skipped"][0]["id"], 99999999)

    def test_empty_request_is_rejected(self):
        response = self.kim.post("/api/inquiries/quick-approve", json={"items": []})
        self.assertEqual(response.status_code, 400)
        self.assertIn("없습니다", response.json()["detail"])

    def test_login_is_required(self):
        response = self.new_client().post("/api/inquiries/quick-approve", json={"items": [{"id": 1, "version": 0}]})
        self.assertEqual(response.status_code, 401)


class SimilarEndpointTest(QuickBase):
    def done(self, body, reply):
        inquiry = self.create(body)
        response = self.kim.post(
            f"/api/inquiries/{inquiry['id']}/edit", json={"version": inquiry["version"], "text": reply}
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def similar(self, inquiry_id, client=None):
        return (client or self.kim).get(f"/api/inquiries/{inquiry_id}/similar")

    def test_returns_similar_done_inquiries_with_their_final_replies_most_similar_first(self):
        near = self.done("쿠폰 쓴 주문을 취소하면 쿠폰은 돌려받을 수 있나요?", "쿠폰은 유효기간이 남았으면 되살아납니다.")
        nearer = self.done("쿠폰 쓴 주문을 취소하면 쿠폰은 돌려받나요", "쿠폰은 돌려드립니다.")
        self.done("ㅋㅋㅋㅋㅋ ㅎㅎㅎㅎㅎ", "확인 후 안내드리겠습니다.")  # 전혀 다른 글
        target = self.create(COUPON_TEXT)
        items = self.similar(target["id"]).json()["items"]
        self.assertEqual([i["id"] for i in items], [nearer["id"], near["id"]])
        self.assertEqual(items[0]["final_reply"], "쿠폰은 돌려드립니다.")
        self.assertEqual(items[0]["body"], "쿠폰 쓴 주문을 취소하면 쿠폰은 돌려받나요")
        self.assertEqual(items[0]["predicted_label_ko"], "취소·환불")
        self.assertGreater(items[0]["similarity_percent"], items[1]["similarity_percent"])
        self.assertTrue(items[0]["resolved_at"])

    def test_never_includes_the_inquiry_itself_or_unfinished_inquiries(self):
        waiting = self.create(COUPON_TEXT)  # 아직 승인 대기 (답장이 없다)
        target = self.create(COUPON_TEXT)
        self.assertEqual(self.similar(target["id"]).json(), {"items": []})
        done = self.done(COUPON_TEXT, "돌려드립니다.")
        self.assertEqual([i["id"] for i in self.similar(done["id"]).json()["items"]], [])  # 자기 자신은 빠진다
        self.assertEqual([i["id"] for i in self.similar(target["id"]).json()["items"]], [done["id"]])
        self.assertNotIn(waiting["id"], [i["id"] for i in self.similar(target["id"]).json()["items"]])

    def test_at_most_three(self):
        for n in range(5):
            self.done(f"쿠폰 쓴 주문을 취소하면 쿠폰은 돌려받나요 {n}", f"답장 {n}")
        target = self.create(COUPON_TEXT)
        self.assertEqual(len(self.similar(target["id"]).json()["items"]), 3)

    def test_nothing_similar_gives_an_empty_list(self):
        self.done("ㅋㅋㅋㅋㅋ ㅎㅎㅎㅎㅎ", "확인 후 안내드리겠습니다.")
        target = self.create(COUPON_TEXT)
        self.assertEqual(self.similar(target["id"]).json(), {"items": []})

    def test_unknown_inquiry_and_login(self):
        self.assertEqual(self.similar(99999999).status_code, 404)
        self.assertEqual(self.similar(1, client=self.new_client()).status_code, 401)


class SimilarFinderTest(QuickBase):
    """뜻 비교(임베딩)와 TF-IDF 대체, 메모리 저장."""

    def done(self, body, reply="답장입니다."):
        inquiry = self.create(body)
        self.kim.post(f"/api/inquiries/{inquiry['id']}/edit", json={"version": inquiry["version"], "text": reply})
        return inquiry["id"]

    def test_uses_meaning_vectors_when_available(self):
        embedder = FakeEmbedder()
        coupon = self.done("쿠폰 문의입니다")
        self.done("배송 문의입니다")
        target = self.create("쿠폰 얘기예요")["id"]
        with self.connect() as conn:
            found = SimilarFinder(embedder).find(conn, target)
        self.assertEqual([f["id"] for f in found], [coupon])  # 단서가 겹치는 것만 비슷하다
        self.assertEqual(found[0]["similarity_percent"], 100.0)
        self.assertEqual(embedder.query_calls, 1)
        self.assertGreaterEqual(embedder.document_calls, 1)

    def test_the_embedding_minimum_is_applied(self):
        embedder = FakeEmbedder()
        self.done("쿠폰 환불 문의입니다")  # 벡터: 환불 1, 쿠폰 1 -> 쿠폰만 있는 문의와 약 0.71
        target = self.create("쿠폰")["id"]
        with self.connect() as conn:
            found = SimilarFinder(embedder).find(conn, target)
        self.assertEqual(len(found), 1)
        self.assertGreaterEqual(found[0]["similarity_percent"], EMBEDDING_MIN_SIMILARITY * 100)
        self.done("쿠폰 환불 배송 정산 페널티 박스 카드 문의입니다")  # 쿠폰과의 유사도 약 0.38 (기준 미만)
        with self.connect() as conn:
            found = SimilarFinder(embedder).find(conn, target)
        self.assertEqual(len(found), 1)

    def test_falls_back_to_tfidf_when_embedding_fails(self):
        similar = self.done("쿠폰 쓴 주문을 취소하면 쿠폰은 돌려받을 수 있나요?")
        target = self.create(COUPON_TEXT)["id"]
        with self.connect() as conn:
            found = SimilarFinder(FakeEmbedder(fail_queries=True)).find(conn, target)
            found_docs = SimilarFinder(FakeEmbedder(fail_documents=True)).find(conn, target)
        self.assertEqual([f["id"] for f in found], [similar])
        self.assertEqual([f["id"] for f in found_docs], [similar])

    def test_unknown_inquiry_returns_none(self):
        with self.connect() as conn:
            self.assertIsNone(SimilarFinder().find(conn, 99999999))
