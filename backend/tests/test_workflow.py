"""Phase 3 시험: 초안 붙이기, 승인·수정·재작성·직접 작성·다시 수정, 동시 처리, 기록, 설정.

임시 DB 영역에서 돌고, 분류는 StubClassifier, 초안은 FakeDrafter가 대신한다.
"""
from app import inquiries as service
from app import workflow
from app.drafting import NO_COVERAGE_NOTE
from tests.base import (
    COUPON_TEXT,
    FIRST_DRAFT,
    PARTIAL_NOTE,
    SECOND_DRAFT,
    ApiTestBase,
    StubClassifier,
)


class WorkflowTest(ApiTestBase):
    @classmethod
    def make_classifier(cls):
        return StubClassifier()

    def setUp(self):
        super().setUp()
        self.classifier.label = "buyer_cancel_refund"
        self.classifier.confidence = 0.95
        self.set_threshold(70)

    # --- 도우미 -------------------------------------------------------------

    def create(self, client, body=COUPON_TEXT):
        response = client.post("/api/inquiries", json={"body": body})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def awaiting(self, client):
        inquiry = self.create(client)
        self.assertEqual(inquiry["status"], "awaiting_approval", inquiry["auto_note"])
        return inquiry

    def manual(self, client):
        """초안을 만들지 못해 '직접 작성'이 된 문의."""
        self.drafter.mode = "error"
        inquiry = self.create(client)
        self.drafter.mode = "ok"
        self.assertEqual(inquiry["status"], "manual")
        return inquiry

    def act(self, client, inquiry, name, **extra):
        return client.post(
            f"/api/inquiries/{inquiry['id']}/{name}", json={"version": inquiry["version"], **extra}
        )

    def detail(self, client, inquiry_id):
        response = client.get(f"/api/inquiries/{inquiry_id}")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def logs_for(self, client, inquiry_id, **params):
        rows = client.get("/api/action-logs", params=params).json()
        return [r for r in rows if r["inquiry_id"] == inquiry_id]

    # --- 처음 초안과 갈래 ----------------------------------------------------

    def test_close_match_gets_a_draft_with_evidence(self):
        kim = self.login("kim")
        inquiry = self.awaiting(kim)
        self.assertEqual(inquiry["current_draft"]["content"], FIRST_DRAFT)
        self.assertEqual(inquiry["current_draft"]["draft_no"], 1)
        self.assertEqual([d["draft_no"] for d in inquiry["drafts"]], [1])
        self.assertEqual(inquiry["actions"], ["approve", "edit", "rewrite"])

        cited = inquiry["current_draft"]["cited"]
        self.assertEqual(cited, [self.drafter.calls[0]["clauses"][0]])
        evidence = inquiry["evidence"]
        self.assertEqual([e["id"] for e in evidence], cited)
        self.assertFalse(inquiry["legacy_only"])
        for shown in evidence:  # 화면에 보이는 근거 번호·제목·원문은 규정 문서와 똑같다
            clause = self.policy.get(shown["id"])
            self.assertEqual(shown["title"], clause.title)
            self.assertEqual(shown["content"], clause.content)
            self.assertEqual(shown["label"], clause.label)

    def test_internal_cautions_are_never_sent_to_the_screen(self):
        kim = self.login("kim")
        self.drafter.cite = lambda clauses: ("BUY-01",) if "BUY-01" in [c.id for c in clauses] else (clauses[0].id,)
        inquiry = self.create(kim, "구매 취소됐는데 거래실패 보상 포인트는 얼마나 받나요 판매자 귀책 페널티")
        text = str(inquiry)
        self.assertNotIn("응대 주의", text)

    def test_no_evidence_still_gets_a_draft_marked_as_not_in_the_policy(self):
        inquiry = self.create(self.login("kim"), "ㅁㅁㅁㅁㅁㅁ ㅋㅋㅋ")
        self.assertEqual(inquiry["status"], "awaiting_approval")
        self.assertIsNone(inquiry["auto_note"])
        self.assertEqual(inquiry["current_draft"]["content"], FIRST_DRAFT)
        self.assertEqual(inquiry["current_draft"]["cited"], [])
        self.assertEqual(inquiry["current_draft"]["uncovered_note"], NO_COVERAGE_NOTE)
        self.assertEqual(inquiry["evidence"], [])
        self.assertEqual(inquiry["actions"], ["approve", "edit", "rewrite"])
        self.assertEqual(self.drafter.calls[0]["clauses"], [])  # 근거 없이 모델을 불렀다

    def test_partly_covered_draft_shows_evidence_and_the_missing_part(self):
        self.drafter.mode = "partial"
        inquiry = self.awaiting(self.login("kim"))
        self.assertTrue(inquiry["evidence"])
        self.assertEqual(inquiry["current_draft"]["uncovered_note"], PARTIAL_NOTE)

    def test_fully_covered_draft_has_no_uncovered_note(self):
        inquiry = self.awaiting(self.login("kim"))
        self.assertIsNone(inquiry["current_draft"]["uncovered_note"])

    def test_the_model_saying_no_clause_applies_is_kept_as_is(self):
        self.drafter.mode = "no_coverage"
        inquiry = self.awaiting(self.login("kim"))
        self.assertEqual(inquiry["current_draft"]["cited"], [])
        self.assertEqual(inquiry["current_draft"]["uncovered_note"], NO_COVERAGE_NOTE)
        self.assertEqual(inquiry["evidence"], [])

    def test_low_confidence_still_gets_a_draft_with_a_warning(self):
        self.classifier.confidence = 0.40
        inquiry = self.create(self.login("kim"))
        self.assertEqual(inquiry["status"], "awaiting_approval")
        self.assertEqual(inquiry["auto_note"], service.low_confidence_note(70))
        self.assertIsNotNone(inquiry["current_draft"])
        self.assertEqual(inquiry["actions"], ["approve", "edit", "rewrite"])

    def test_low_confidence_looks_for_evidence_in_the_whole_policy(self):
        body = "정산금이 언제 입금되나요 정산 일정이 궁금해요"
        kim = self.login("kim")
        self.create(kim, body)  # 확신도 높음: 분류(취소·환불)에 연결된 조항에서만 찾는다
        confident = self.drafter.calls[-1]["clauses"]
        self.assertFalse([c for c in confident if c.startswith("STL")])
        self.classifier.confidence = 0.40  # 확신도 낮음: 분류를 믿지 않고 정책 전체에서 찾는다
        self.create(kim, body)
        unsure = self.drafter.calls[-1]["clauses"]
        self.assertTrue([c for c in unsure if c.startswith("STL")], unsure)

    def test_drafter_problems_send_the_inquiry_to_manual(self):
        cases = {
            "error": service.AUTO_FAIL_NOTE,
            "bad_id": service.BAD_CITATION_NOTE,  # 규정 문서에 없는 조항 번호
            "not_provided": service.BAD_CITATION_NOTE,  # 있는 번호지만 제공하지 않은 조항
        }
        kim = self.login("kim")
        for mode, note in cases.items():
            with self.subTest(mode=mode):
                self.drafter.mode = mode
                inquiry = self.create(kim)
                self.assertEqual(inquiry["status"], "manual")
                self.assertEqual(inquiry["auto_note"], note)
                self.assertEqual(inquiry["drafts"], [])
                self.assertEqual(inquiry["actions"], ["manual_reply"])

    # --- 승인 -----------------------------------------------------------------

    def test_approve(self):
        kim = self.login("kim")
        inquiry = self.awaiting(kim)
        response = self.act(kim, inquiry, "approve")
        self.assertEqual(response.status_code, 200, response.text)
        done = response.json()
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["status_ko"], "처리 완료")
        self.assertEqual(done["final_reply"], FIRST_DRAFT)
        self.assertEqual(done["resolved_by_name"], "김상담")
        self.assertEqual(done["version"], inquiry["version"] + 1)
        self.assertEqual(done["actions"], ["reedit"])

        (log,) = self.logs_for(kim, inquiry["id"], action="approve")
        self.assertEqual(log["agent_username"], "kim")
        self.assertEqual(log["action_ko"], "승인")
        self.assertEqual(log["draft_text"], FIRST_DRAFT)
        self.assertEqual(log["final_reply"], FIRST_DRAFT)

    def test_approve_needs_the_version_you_saw(self):
        kim = self.login("kim")
        inquiry = self.awaiting(kim)
        missing = kim.post(f"/api/inquiries/{inquiry['id']}/approve", json={})
        self.assertEqual(missing.status_code, 400)
        self.assertEqual(self.detail(kim, inquiry["id"])["status"], "awaiting_approval")

    def test_unknown_inquiry_is_404(self):
        kim = self.login("kim")
        for name in ("approve", "edit", "rewrite", "handoff", "manual-reply"):
            response = kim.post(f"/api/inquiries/99999999/{name}", json={"version": 0, "text": "답장"})
            self.assertEqual(response.status_code, 404, name)

    # --- 동시 처리 -------------------------------------------------------------

    def test_first_to_save_wins_and_the_second_is_told(self):
        kim, park = self.login("kim"), self.login("park")
        inquiry = self.awaiting(kim)
        seen_by_park = self.detail(park, inquiry["id"])

        self.assertEqual(self.act(kim, inquiry, "approve").status_code, 200)
        late = self.act(park, seen_by_park, "edit", text="박상담이 고친 답장")
        self.assertEqual(late.status_code, 409)
        body = late.json()
        self.assertEqual(body["detail"], workflow.CONFLICT_MESSAGE)
        self.assertEqual(body["inquiry"]["status"], "done")  # 최신 상태를 함께 돌려준다
        self.assertEqual(body["inquiry"]["resolved_by_name"], "김상담")

        # 박상담의 수정은 반영되지 않았고 기록도 남지 않았다
        latest = self.detail(park, inquiry["id"])
        self.assertEqual(latest["final_reply"], FIRST_DRAFT)
        self.assertEqual(self.logs_for(park, inquiry["id"], action="edit"), [])

    def test_second_approve_with_the_old_version_is_rejected(self):
        kim, park = self.login("kim"), self.login("park")
        inquiry = self.awaiting(kim)
        self.assertEqual(self.act(kim, inquiry, "approve").status_code, 200)
        self.assertEqual(self.act(park, inquiry, "approve").status_code, 409)
        self.assertEqual(len(self.logs_for(kim, inquiry["id"], action="approve")), 1)

    # --- 수정 ------------------------------------------------------------------

    def test_edit_finishes_the_inquiry_as_edited_approval(self):
        kim = self.login("kim")
        inquiry = self.awaiting(kim)
        response = self.act(kim, inquiry, "edit", text="  상담사가 고친 답장입니다.  ")
        self.assertEqual(response.status_code, 200, response.text)
        done = response.json()
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["final_reply"], "상담사가 고친 답장입니다.")
        (log,) = self.logs_for(kim, inquiry["id"], action="edit")
        self.assertEqual(log["draft_text"], FIRST_DRAFT)
        self.assertEqual(log["final_reply"], "상담사가 고친 답장입니다.")

    def test_empty_edit_is_rejected_and_nothing_changes(self):
        kim = self.login("kim")
        inquiry = self.awaiting(kim)
        for text in ("", "   ", None):
            response = self.act(kim, inquiry, "edit", text=text)
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"], "답장 내용을 입력하세요.")
        after = self.detail(kim, inquiry["id"])
        self.assertEqual(after["status"], "awaiting_approval")
        self.assertEqual(after["version"], inquiry["version"])
        self.assertEqual(self.logs_for(kim, inquiry["id"]), [])

    def test_edit_is_not_for_manual_inquiries(self):
        kim = self.login("kim")
        inquiry = self.manual(kim)
        response = self.act(kim, inquiry, "edit", text="답장")
        self.assertEqual(response.status_code, 409)
        self.assertIn("직접 작성", response.json()["detail"])

    def test_reedit_keeps_the_status_and_adds_a_log_line(self):
        kim, park = self.login("kim"), self.login("park")
        inquiry = self.awaiting(kim)
        first = self.act(kim, inquiry, "edit", text="처음 고친 답장").json()

        response = self.act(park, first, "edit", text="박상담이 다시 고친 답장")
        self.assertEqual(response.status_code, 200, response.text)
        again = response.json()
        self.assertEqual(again["status"], "done")
        self.assertEqual(again["final_reply"], "박상담이 다시 고친 답장")
        self.assertEqual(again["resolved_by_name"], "김상담")  # 처음 처리한 사람은 그대로
        self.assertEqual(again["version"], first["version"] + 1)

        lines = self.logs_for(park, inquiry["id"], action="edit")
        self.assertEqual(len(lines), 2)  # 예전 기록은 지워지지 않고 한 줄이 쌓인다
        self.assertEqual({l["agent_username"] for l in lines}, {"kim", "park"})

    # --- 재작성 ----------------------------------------------------------------

    def test_rewrite_gives_a_second_draft_once(self):
        kim = self.login("kim")
        inquiry = self.awaiting(kim)
        first_clauses = inquiry["current_draft"]["cited"]

        response = self.act(kim, inquiry, "rewrite")
        self.assertEqual(response.status_code, 200, response.text)
        second = response.json()
        self.assertEqual(second["rewrite_count"], 1)
        self.assertEqual([d["draft_no"] for d in second["drafts"]], [1, 2])
        self.assertEqual(second["current_draft"]["content"], SECOND_DRAFT)
        self.assertEqual(second["status"], "awaiting_approval")
        self.assertEqual(second["actions"], ["approve", "edit", "handoff"])  # 재작성 버튼은 사라진다

        call = self.drafter.calls[-1]
        self.assertEqual(call["avoid"], FIRST_DRAFT)  # 이전 초안과 다르게 쓰라고 지시
        self.assertEqual(call["clauses"], first_clauses)  # 첫 초안과 같은 규정 문서으로 쓴다

        (log,) = self.logs_for(kim, inquiry["id"], action="rewrite")
        self.assertEqual(log["draft_text"], FIRST_DRAFT)
        self.assertEqual(log["new_draft_text"], SECOND_DRAFT)

        third = self.act(kim, second, "rewrite")
        self.assertEqual(third.status_code, 409)
        self.assertIn("1번만", third.json()["detail"])

    def test_rewrite_of_a_draft_without_clauses_searches_again_and_keeps_the_note(self):
        kim = self.login("kim")
        self.drafter.mode = "no_coverage"
        inquiry = self.awaiting(kim)
        self.drafter.mode = "partial"
        second = self.act(kim, inquiry, "rewrite").json()
        self.assertEqual(second["current_draft"]["draft_no"], 2)
        self.assertTrue(second["current_draft"]["cited"])  # 다시 찾은 규정 문서
        self.assertEqual(second["current_draft"]["uncovered_note"], PARTIAL_NOTE)
        self.assertEqual(second["drafts"][0]["uncovered_note"], NO_COVERAGE_NOTE)  # 첫 초안은 그대로

    def test_failed_rewrite_keeps_the_first_draft_and_is_not_counted(self):
        kim = self.login("kim")
        inquiry = self.awaiting(kim)
        for mode in ("error", "bad_id", "not_provided"):
            with self.subTest(mode=mode):
                self.drafter.mode = mode
                response = self.act(kim, inquiry, "rewrite")
                self.assertEqual(response.status_code, 502)
                self.assertEqual(response.json()["detail"], workflow.REWRITE_FAIL_MESSAGE)
                after = self.detail(kim, inquiry["id"])
                self.assertEqual(after["rewrite_count"], 0)
                self.assertEqual(len(after["drafts"]), 1)
                self.assertEqual(after["version"], inquiry["version"])
                self.assertIn("rewrite", after["actions"])
                self.assertEqual(self.logs_for(kim, inquiry["id"], action="rewrite"), [])

        self.drafter.mode = "ok"
        self.assertEqual(self.act(kim, inquiry, "rewrite").status_code, 200)  # 같은 version으로 다시 성공

    # --- 직접 작성으로 넘기기, 직접 작성 -----------------------------------------

    def test_handoff_only_after_a_rewrite(self):
        kim = self.login("kim")
        inquiry = self.awaiting(kim)
        early = self.act(kim, inquiry, "handoff")
        self.assertEqual(early.status_code, 409)

        second = self.act(kim, inquiry, "rewrite").json()
        logs_before = len(self.logs_for(kim, inquiry["id"]))
        response = self.act(kim, second, "handoff")
        self.assertEqual(response.status_code, 200, response.text)
        handed = response.json()
        self.assertEqual(handed["status"], "manual")
        self.assertEqual(handed["actions"], ["manual_reply"])
        self.assertEqual(len(self.logs_for(kim, inquiry["id"])), logs_before)  # 넘기기 자체는 기록에 넣지 않는다

        done = self.act(kim, handed, "manual-reply", text="직접 쓴 답장")
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(done.json()["status"], "done")

    def test_manual_reply(self):
        kim = self.login("kim")
        inquiry = self.manual(kim)
        for text in ("", "  ", None):
            response = self.act(kim, inquiry, "manual-reply", text=text)
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.detail(kim, inquiry["id"])["status"], "manual")

        response = self.act(kim, inquiry, "manual-reply", text="  직접 쓴 답장입니다.  ")
        self.assertEqual(response.status_code, 200, response.text)
        done = response.json()
        self.assertEqual(done["status"], "done")
        self.assertEqual(done["final_reply"], "직접 쓴 답장입니다.")
        self.assertEqual(done["resolved_by_name"], "김상담")
        (log,) = self.logs_for(kim, inquiry["id"], action="manual_write")
        self.assertEqual(log["action_ko"], "직접 작성")
        self.assertEqual(log["final_reply"], "직접 쓴 답장입니다.")
        self.assertIsNone(log["draft_text"])

    def test_manual_reply_is_only_for_manual_inquiries(self):
        kim = self.login("kim")
        inquiry = self.awaiting(kim)
        self.assertEqual(self.act(kim, inquiry, "manual-reply", text="답장").status_code, 409)

    # --- 위험 표현 --------------------------------------------------------------

    def test_risky_phrases_are_warned_but_never_block(self):
        kim = self.login("kim")
        self.drafter.text = "안녕하세요, 고객님. 전액 보상해 드리겠습니다. 감사합니다."
        inquiry = self.awaiting(kim)
        warning = inquiry["risk_warnings"][0]
        self.assertEqual(warning["sentence"], "전액 보상해 드리겠습니다.")
        self.assertIn("보상해 드", warning["phrases"])
        self.assertIn("전액 보상", warning["phrases"])

        approved = self.act(kim, inquiry, "approve")  # 경고가 있어도 승인할 수 있다
        self.assertEqual(approved.status_code, 200)
        self.assertEqual(approved.json()["risk_warnings"][0]["sentence"], "전액 보상해 드리겠습니다.")

    def test_edited_and_manual_text_are_checked_too(self):
        kim = self.login("kim")
        edited = self.act(kim, self.awaiting(kim), "edit", text="판정 바꿔 드릴게요.")
        self.assertEqual(edited.status_code, 200)  # 저장은 된다
        self.assertEqual(edited.json()["risk_warnings"][0]["sentence"], "판정 바꿔 드릴게요.")

        written = self.act(kim, self.manual(kim), "manual-reply", text="무조건 도와드립니다.")
        self.assertEqual(written.status_code, 200)
        self.assertEqual(written.json()["risk_warnings"][0]["phrases"], ["무조건"])

    def test_risk_check_before_saving(self):
        kim = self.login("kim")
        found = kim.post("/api/risk-check", json={"text": "안녕하세요. 보상해드릴게요. 감사합니다."}).json()
        self.assertEqual([w["sentence"] for w in found["warnings"]], ["보상해드릴게요."])
        clean = kim.post("/api/risk-check", json={"text": "확인 후 안내드리겠습니다."}).json()
        self.assertEqual(clean["warnings"], [])
        self.assertEqual(kim.post("/api/risk-check", json={}).json()["warnings"], [])

    def test_risky_phrase_list(self):
        kim = self.login("kim")
        phrases = kim.get("/api/risky-phrases").json()
        self.assertEqual(len(phrases), 20)

        added = kim.post("/api/risky-phrases", json={"phrase": "  특별 지원금  "})
        self.assertEqual(added.status_code, 201, added.text)
        names = [p["phrase"] for p in added.json()]
        self.assertEqual(len(names), 21)
        self.assertEqual(added.json()[-1]["created_by_name"], "김상담")
        found = kim.post("/api/risk-check", json={"text": "특별 지원금을 드립니다."}).json()
        self.assertEqual(len(found["warnings"]), 1)  # 새 문구가 바로 검사에 쓰인다

        for payload, message in (({"phrase": "특별 지원금"}, "이미 목록에 있는"), ({"phrase": "  "}, "입력하세요"), ({}, "입력하세요")):
            response = kim.post("/api/risky-phrases", json=payload)
            self.assertEqual(response.status_code, 400)
            self.assertIn(message, response.json()["detail"])
        self.assertEqual(len(kim.get("/api/risky-phrases").json()), 21)

    # --- 구버전 근거 ------------------------------------------------------------

    def test_legacy_only_evidence_is_flagged(self):
        kim = self.login("kim")
        self.classifier.label = "buyer_inspection_result"
        body = "신발에서 곰팡이 냄새가 심하게 나요 담배 냄새도 나요"
        self.drafter.cite = lambda clauses: ("SNK-08",)
        inquiry = self.create(kim, body)
        self.assertEqual(inquiry["status"], "awaiting_approval", inquiry["auto_note"])
        self.assertTrue(inquiry["legacy_only"])
        self.assertTrue(all(e["legacy"] for e in inquiry["evidence"]))

        # 현행 조항(HOLD-01)과 구버전 조항(SNK-08)이 함께 근거이면 경고하지 않는다
        self.drafter.cite = lambda clauses: ("HOLD-01", "SNK-08")
        mixed = self.create(kim, "검수 보류 사유를 보고 구매 여부를 선택했어요 곰팡이 냄새 담배 냄새가 나는 신발이에요")
        self.assertEqual(mixed["status"], "awaiting_approval", mixed["auto_note"])
        self.assertEqual({e["id"] for e in mixed["evidence"]}, {"HOLD-01", "SNK-08"})
        self.assertFalse(mixed["legacy_only"])

        # 현행 조항만 근거여도 경고하지 않는다
        self.drafter.cite = lambda clauses: ("HOLD-01",)
        current = self.create(kim, "검수 보류 사유를 보고 구매 여부를 선택했어요 곰팡이 냄새 담배 냄새가 나는 신발이에요")
        self.assertFalse(current["legacy_only"])

    # --- 작업 기록 --------------------------------------------------------------

    def test_action_log_filters(self):
        kim, park = self.login("kim"), self.login("park")
        self.act(kim, self.awaiting(kim), "approve")
        self.act(park, self.awaiting(park), "edit", text="박상담 수정")
        self.act(park, self.manual(park), "manual-reply", text="박상담 직접 작성")

        everything = kim.get("/api/action-logs").json()
        times = [r["created_at"] for r in everything]
        self.assertEqual(times, sorted(times, reverse=True))  # 최신순

        only_park = kim.get("/api/action-logs", params={"agent": "park"}).json()
        self.assertTrue(only_park)
        self.assertEqual({r["agent_username"] for r in only_park}, {"park"})
        only_edit = kim.get("/api/action-logs", params={"action": "edit"}).json()
        self.assertEqual({r["action"] for r in only_edit}, {"edit"})
        both = kim.get("/api/action-logs", params={"agent": "park", "action": "manual_write"}).json()
        self.assertEqual({(r["agent_username"], r["action"]) for r in both}, {("park", "manual_write")})
        self.assertEqual(kim.get("/api/action-logs", params={"agent": "nobody"}).json(), [])
        self.assertEqual(kim.get("/api/action-logs", params={"action": "nope"}).status_code, 400)

        row = everything[0]
        for key in ("created_at", "agent_name", "action_ko", "inquiry_id", "inquiry_body", "final_reply"):
            self.assertIn(key, row)

    # --- 기준값 -----------------------------------------------------------------

    def test_threshold_settings(self):
        kim = self.login("kim")
        settings = kim.get("/api/settings").json()
        self.assertEqual(settings, {"confidence_threshold": 70, "min": 50, "max": 95})

        changed = kim.put("/api/settings/confidence-threshold", json={"value": 80})
        self.assertEqual(changed.status_code, 200)
        self.assertEqual(changed.json()["confidence_threshold"], 80)
        self.assertEqual(self.login("park").get("/api/settings").json()["confidence_threshold"], 80)

        # 저장한 뒤 새로 들어오는 문의부터 적용된다 (기준값 아래면 경고가 붙는다)
        self.classifier.confidence = 0.75
        self.assertEqual(self.create(kim)["auto_note"], service.low_confidence_note(80))
        kim.put("/api/settings/confidence-threshold", json={"value": 70})
        self.assertIsNone(self.create(kim)["auto_note"])

    def test_threshold_must_be_a_whole_number_from_50_to_95(self):
        kim = self.login("kim")
        for value in (50, 95):
            self.assertEqual(kim.put("/api/settings/confidence-threshold", json={"value": value}).status_code, 200)
        for value in (49, 96, 0, 100, -5, "70", "abc", 70.5, True, None, [70]):
            response = kim.put("/api/settings/confidence-threshold", json={"value": value})
            self.assertEqual(response.status_code, 400, repr(value))
        self.assertEqual(kim.put("/api/settings/confidence-threshold", json={}).status_code, 400)
        self.assertEqual(kim.get("/api/settings").json()["confidence_threshold"], 95)  # 마지막 정상 값 그대로

    def test_threshold_change_does_not_touch_existing_inquiries(self):
        kim = self.login("kim")
        inquiry = self.awaiting(kim)
        kim.put("/api/settings/confidence-threshold", json={"value": 95})
        self.assertEqual(self.detail(kim, inquiry["id"])["status"], "awaiting_approval")

    # --- 로그인 -----------------------------------------------------------------

    def test_everything_needs_login(self):
        anonymous = self.new_client()
        calls = [
            anonymous.post("/api/inquiries/1/approve", json={"version": 0}),
            anonymous.post("/api/inquiries/1/edit", json={"version": 0, "text": "x"}),
            anonymous.post("/api/inquiries/1/rewrite", json={"version": 0}),
            anonymous.post("/api/inquiries/1/handoff", json={"version": 0}),
            anonymous.post("/api/inquiries/1/manual-reply", json={"version": 0, "text": "x"}),
            anonymous.get("/api/action-logs"),
            anonymous.get("/api/settings"),
            anonymous.put("/api/settings/confidence-threshold", json={"value": 70}),
            anonymous.get("/api/risky-phrases"),
            anonymous.post("/api/risky-phrases", json={"phrase": "x"}),
            anonymous.post("/api/risk-check", json={"text": "x"}),
        ]
        for response in calls:
            self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    import unittest

    unittest.main()
