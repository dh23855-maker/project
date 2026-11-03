"""정답 표(retrieval_gold.csv) 시험: 형식, 평가용 문의와의 일치, 잘못된 파일을 알아내는가."""
import tempfile
import unittest
from pathlib import Path

from app.policy import PolicyBook
from ml.data import EVAL_PATH, load_dataset
from ml.retrieval_data import GOLD_PATH, load_gold

HEADER = "eval_row,text,label,difficulty,gold,coverage\n"


class RetrievalGoldFileTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.book = PolicyBook()
        cls.rows = load_gold(cls.book)

    def test_covers_every_eval_question_once_in_order(self):
        evals = load_dataset(EVAL_PATH, with_difficulty=True)
        self.assertEqual(len(self.rows), len(evals))
        for gold, ev in zip(self.rows, evals):
            self.assertEqual(gold["text"], ev["text"])
            self.assertEqual(gold["label"], ev["label"])
            self.assertEqual(gold["difficulty"], ev["difficulty"])

    def test_gold_clauses_exist_and_belong_to_some_mapping(self):
        mapped = {i for ids in self.book._intents.values() for i in ids}
        for row in self.rows:
            for clause_id in row["gold"]:
                self.assertIn(clause_id, mapped, row["text"])

    def test_most_answers_are_found_inside_the_classified_label(self):
        # 정답 조항이 그 문의 종류의 후보 목록에 하나도 없으면 분류가 맞아도 찾을 수 없다
        stuck = [
            r["eval_row"]
            for r in self.rows
            if r["gold"] and not set(r["gold"]) & {c.id for c in self.book.candidates(r["label"])}
        ]
        self.assertLessEqual(len(stuck), len(self.rows) // 10, stuck)

    def test_counts_by_coverage(self):
        counts = {k: sum(1 for r in self.rows if r["coverage"] == k) for k in ("full", "partial", "none")}
        self.assertEqual(counts, {"full": 90, "partial": 44, "none": 6})


class RetrievalGoldErrorTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.book = PolicyBook()

    def load(self, body):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "gold.csv"
            path.write_text(HEADER + body, encoding="utf-8")
            return load_gold(self.book, path)

    def test_ok_row(self):
        rows = self.load("0,배송이 늦어요,buyer_delivery,easy,DLV-03 DLV-05,full\n")
        self.assertEqual(rows[0]["gold"], ["DLV-03", "DLV-05"])

    def test_unknown_clause(self):
        with self.assertRaisesRegex(ValueError, "ZZZ-99"):
            self.load("0,배송이 늦어요,buyer_delivery,easy,ZZZ-99,full\n")

    def test_none_must_have_no_gold_and_vice_versa(self):
        with self.assertRaisesRegex(ValueError, "coverage가 none"):
            self.load("0,배송이 늦어요,buyer_delivery,easy,DLV-03,none\n")
        with self.assertRaisesRegex(ValueError, "coverage가 none"):
            self.load("0,배송이 늦어요,buyer_delivery,easy,,full\n")

    def test_bad_label_difficulty_coverage_and_duplicates(self):
        with self.assertRaisesRegex(ValueError, "label"):
            self.load("0,문의,없는종류,easy,DLV-03,full\n")
        with self.assertRaisesRegex(ValueError, "difficulty"):
            self.load("0,문의,buyer_delivery,아주쉬움,DLV-03,full\n")
        with self.assertRaisesRegex(ValueError, "coverage"):
            self.load("0,문의,buyer_delivery,easy,DLV-03,almost\n")
        with self.assertRaisesRegex(ValueError, "중복"):
            self.load("0,문의,buyer_delivery,easy,DLV-03 DLV-03,full\n")

    def test_empty_text_and_empty_file(self):
        with self.assertRaisesRegex(ValueError, "비어 있습니다"):
            self.load("0,   ,buyer_delivery,easy,DLV-03,full\n")
        with self.assertRaisesRegex(ValueError, "하나도 없습니다"):
            self.load("")

    def test_missing_file(self):
        with self.assertRaises(FileNotFoundError):
            load_gold(self.book, GOLD_PATH.with_name("없는파일.csv"))


if __name__ == "__main__":
    unittest.main()
