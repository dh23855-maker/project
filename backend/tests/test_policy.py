"""Phase 3 시험: 규정 문서 읽기와 규정 문서 찾기 (DB·OpenAI 없이 돈다)."""
import unittest

from app.policy import LABEL_TO_INTENT, POLICY_PATH, PolicyBook, PolicyError, parse_policy

ALLOWED_LABELS = {"현행", "구버전", "구버전 포함", "현행 우선", "예시", "가상"}
COUPON_TEXT = "쿠폰 쓴 주문을 취소하면 쿠폰은 돌려받나요?"


class PolicyFileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.book = PolicyBook()

    def test_102_clauses_with_unique_ids(self):
        ids = [c.id for c in self.book.clauses]
        self.assertEqual(len(ids), 102)
        self.assertEqual(len(set(ids)), 102)

    def test_every_clause_is_in_the_mapping_table_and_has_examples(self):
        mapped = {i for ids in self.book._intents.values() for i in ids}
        for clause in self.book.clauses:
            self.assertIn(clause.id, mapped, clause.id)
            self.assertTrue(clause.examples, f"{clause.id}에 '이런 문의에 쓰임'이 없습니다")
            self.assertNotIn("이런 문의에 쓰임", clause.content, clause.id)

    def test_every_clause_has_a_known_label(self):
        for clause in self.book.clauses:
            self.assertIn(clause.label, ALLOWED_LABELS, clause.id)

    def test_4_fictional_clauses(self):
        self.assertEqual(sorted(c.id for c in self.book.clauses if c.label == "가상"), ["GEN-07", "STL-02", "STL-04", "STL-05"])

    def test_caution_lines_are_kept_apart_from_content(self):
        pen06 = self.book.get("PEN-06")
        self.assertTrue(pen06.cautions)
        self.assertNotIn("응대 주의", pen06.content)
        for clause in self.book.clauses:
            self.assertNotIn("응대 주의:", clause.content, clause.id)
            self.assertNotIn("응대 주의:", clause.to_dict()["content"], clause.id)
        self.assertIn("약속", self.book.get("GEN-02").cautions[0])

    def test_legacy_flag(self):
        self.assertEqual([c.id for c in self.book.clauses if c.legacy], ["SNK-08"])
        for current_id in ("PEN-01", "SNK-03", "BUY-01", "RFD-01", "DLV-04", "PKG-01"):
            self.assertFalse(self.book.get(current_id).legacy, current_id)

    def test_table_content_is_kept(self):
        self.assertIn("찌그러짐", self.book.get("PKG-01").content)
        self.assertIn("30%", self.book.get("PKG-01").content)
        self.assertIn("12.0cm", self.book.get("PKG-01").content)

    def test_example_lines_are_searchable_but_not_content(self):
        clause = self.book.get("PEN-06")
        self.assertIn("소명하고 싶어요", clause.examples)
        self.assertIn("소명하고 싶어요", clause.search_text)
        self.assertNotIn("소명하고 싶어요", clause.content)
        self.assertNotIn("examples", clause.to_dict())

    def test_every_label_has_candidates_in_the_mapping_table(self):
        for label in LABEL_TO_INTENT:
            self.assertTrue(self.book.candidates(label), label)
        settlement = [c.id for c in self.book.candidates("seller_settlement")]
        self.assertEqual(settlement[:7], [f"STL-0{n}" for n in range(1, 8)])

    def test_no_real_company_names(self):
        text = POLICY_PATH.read_text(encoding="utf-8")
        for word in ("KREAM", "kream", "크림", "ReplyDesk", "http://", "https://"):
            self.assertNotIn(word, text)


class ParseErrorTest(unittest.TestCase):
    GOOD_MAP = "## 의도 → 조항 매핑\n| 의도 | 관련 조항 |\n|---|---|\n"

    def test_header_without_label_is_an_error(self):
        text = self.GOOD_MAP + "\n---\n\n### [AAA-01] 제목만 있음\n- 내용\n"
        with self.assertRaisesRegex(PolicyError, "형식이 틀렸습니다"):
            parse_policy(text)

    def test_duplicate_ids(self):
        text = self.GOOD_MAP + "\n---\n### [AAA-01] 하나 [현행]\n- 내용\n### [AAA-01] 둘 [현행]\n- 내용\n"
        with self.assertRaisesRegex(PolicyError, "중복"):
            parse_policy(text)

    def test_mapping_to_a_missing_clause(self):
        text = self.GOOD_MAP + "| 구매자-배송 | AAA-01~02 |\n\n---\n### [AAA-01] 하나 [현행]\n- 내용\n"
        with self.assertRaisesRegex(PolicyError, "AAA-02"):
            parse_policy(text)

    def test_empty_clause(self):
        text = self.GOOD_MAP + "\n---\n### [AAA-01] 빈 조항 [현행]\n- 응대 주의: 주의만 있음\n"
        with self.assertRaisesRegex(PolicyError, "내용이 없습니다"):
            parse_policy(text)

    def test_ranges_expand(self):
        text = self.GOOD_MAP + "| 구매자-배송 | AAA-01~03, BBB-01 |\n\n---\n" + "".join(
            f"### [{i}] 조항 [현행]\n- 내용\n" for i in ("AAA-01", "AAA-02", "AAA-03", "BBB-01")
        )
        _, intents = parse_policy(text)
        self.assertEqual(intents["구매자-배송"], ["AAA-01", "AAA-02", "AAA-03", "BBB-01"])


class EvidenceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.book = PolicyBook()

    def test_close_match_is_found_first(self):
        found = self.book.find_evidence("buyer_cancel_refund", COUPON_TEXT)
        self.assertTrue(found)
        self.assertEqual(found[0][0].id, "RFD-04")

    def test_at_most_three(self):
        found = self.book.find_evidence("buyer_inspection_result", "박스 찌그러짐 찢어짐 검수 기준 오염", min_score=0.0)
        self.assertEqual(len(found), 3)

    def test_unrelated_text_finds_nothing(self):
        self.assertEqual(self.book.find_evidence("buyer_delivery", "ㅁㄴㅇㄹ asdf qwer"), [])
        self.assertEqual(self.book.find_evidence("buyer_delivery", "   "), [])

    def test_search_stays_inside_the_classified_label(self):
        allowed = {c.id for c in self.book.candidates("seller_settlement")}
        scored = self.book.scores("seller_settlement", "쿠폰 취소 환불 배송 박스")
        self.assertEqual({c.id for c, _ in scored}, allowed)
        self.assertNotIn("RFD-04", allowed)

    def test_higher_bar_finds_less(self):
        loose = self.book.find_evidence("buyer_cancel_refund", COUPON_TEXT, min_score=0.0)
        strict = self.book.find_evidence("buyer_cancel_refund", COUPON_TEXT, min_score=0.9)
        self.assertGreater(len(loose), len(strict))
        self.assertEqual(strict, [])

    def test_scores_are_sorted_high_to_low(self):
        scores = [s for _, s in self.book.scores("buyer_cancel_refund", COUPON_TEXT)]
        self.assertEqual(scores, sorted(scores, reverse=True))


if __name__ == "__main__":
    unittest.main()
