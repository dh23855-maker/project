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


class FakeEmbedder:
    """뜻 비교를 흉내 낸다: 글에 나온 낱말(단서)의 개수를 세어 벡터로 만든다 (OpenAI를 부르지 않는다)."""

    CUES = ["환불", "쿠폰", "배송", "정산", "페널티", "박스", "카드", "소명"]

    def __init__(self, fail_documents=False, fail_queries=False):
        self.fail_documents, self.fail_queries = fail_documents, fail_queries
        self.document_calls = self.query_calls = 0

    def _vector(self, text):
        import numpy as np

        v = np.array([text.count(c) for c in self.CUES], dtype=float)
        norm = np.linalg.norm(v)
        return v / norm if norm else v  # 단서가 하나도 없으면 영벡터(아무 조항과도 비슷하지 않음)

    def embed(self, texts):
        import numpy as np

        self.document_calls += 1
        if self.fail_documents:
            raise RuntimeError("조항 임베딩 실패")
        return np.array([self._vector(t) for t in texts])

    def embed_query(self, text):
        self.query_calls += 1
        if self.fail_queries:
            raise RuntimeError("문의 임베딩 실패")
        return self._vector(text)


class EmbeddingSearchTest(unittest.TestCase):
    def test_default_book_uses_tfidf_only(self):
        self.assertFalse(PolicyBook().uses_embedding)

    def test_embedding_ranks_by_meaning_and_uses_its_own_bar(self):
        embedder = FakeEmbedder()
        book = PolicyBook(embedder=embedder)
        self.assertTrue(book.uses_embedding)
        # "소명"이라는 낱말만 있는 문의: 글자 조각이 아니라 벡터(낱말 단서)로 가장 가까운 조항이 1등
        ranked = book.scores("seller_penalty", "소명 소명 소명")
        top = ranked[0][0]
        self.assertGreater(top.search_text.count("소명"), 0)
        self.assertEqual(ranked, sorted(ranked, key=lambda p: -p[1]))
        # 임베딩 점수에는 임베딩용 기준(0.24)이 적용된다: 아무 단서도 없는 문의는 점수가 낮아 걸러진다
        self.assertEqual(book.find_evidence("seller_penalty", "ㅁㄴㅇㄹ"), [])
        self.assertTrue(book.find_evidence("seller_penalty", "소명 소명 소명"))

    def test_each_method_uses_its_own_bar(self):
        from unittest import mock

        import app.policy as policy_module

        book = PolicyBook(embedder=FakeEmbedder())
        self.assertTrue(book.find_evidence("seller_penalty", "소명 소명 소명"))
        with mock.patch.object(policy_module, "EMBEDDING_MIN_SIMILARITY", 1.5):
            self.assertEqual(book.find_evidence("seller_penalty", "소명 소명 소명"), [])
        # TF-IDF 기준(MIN_SIMILARITY)은 임베딩으로 찾을 때 영향을 주지 않는다
        with mock.patch.object(policy_module, "MIN_SIMILARITY", 1.5):
            self.assertTrue(book.find_evidence("seller_penalty", "소명 소명 소명"))
            self.assertEqual(PolicyBook().find_evidence("buyer_cancel_refund", COUPON_TEXT), [])

    def test_embedding_search_stays_inside_the_label_and_can_search_everything(self):
        book = PolicyBook(embedder=FakeEmbedder())
        inside = {c.id for c, _ in book.scores("seller_settlement", "쿠폰 환불")}
        self.assertEqual(inside, {c.id for c in book.candidates("seller_settlement")})
        everything = {c.id for c, _ in book.scores(None, "쿠폰 환불")}
        self.assertEqual(everything, {c.id for c in book.clauses})

    def test_falls_back_to_tfidf_when_clause_embedding_fails(self):
        embedder = FakeEmbedder(fail_documents=True)
        with self.assertLogs("app.policy", level="ERROR"):
            book = PolicyBook(embedder=embedder)
        self.assertFalse(book.uses_embedding)
        self.assertEqual(book.find_evidence("buyer_cancel_refund", COUPON_TEXT)[0][0].id, "RFD-04")
        self.assertEqual(embedder.query_calls, 0)

    def test_falls_back_to_tfidf_for_one_search_when_query_embedding_fails(self):
        book = PolicyBook(embedder=FakeEmbedder(fail_queries=True))
        self.assertTrue(book.uses_embedding)
        with self.assertLogs("app.policy", level="ERROR"):
            found = book.find_evidence("buyer_cancel_refund", COUPON_TEXT)
        self.assertEqual(found[0][0].id, "RFD-04")
        self.assertEqual(found, PolicyBook().find_evidence("buyer_cancel_refund", COUPON_TEXT))

    def test_blank_text_never_calls_the_embedder(self):
        embedder = FakeEmbedder()
        book = PolicyBook(embedder=embedder)
        self.assertEqual(book.scores("buyer_delivery", "   "), [])
        self.assertEqual(embedder.query_calls, 0)
