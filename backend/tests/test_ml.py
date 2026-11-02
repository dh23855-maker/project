"""Phase 1 시험: 데이터 점검, 평가 계산, 모델 학습.

실행 (backend 폴더에서):
    .venv\\Scripts\\python.exe -m unittest discover -s tests -t . -v
"""
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from ml.data import (
    EVAL_PATH,
    TRAIN_PATH,
    find_duplicates,
    find_overlap,
    load_dataset,
)
from ml.evaluate import compute_metrics, run
from ml.labels import LABELS


def write_csv(directory, name, content):
    path = Path(directory) / name
    path.write_text(content, encoding="utf-8")
    return path


class TrainDataTest(unittest.TestCase):
    def setUp(self):
        self.rows = load_dataset(TRAIN_PATH)

    def test_total_is_300(self):
        self.assertEqual(len(self.rows), 300)

    def test_each_label_has_40_to_50(self):
        counts = Counter(r["label"] for r in self.rows)
        for label in LABELS:
            self.assertTrue(40 <= counts[label] <= 50, f"{label}: {counts[label]}개")

    def test_no_duplicates(self):
        self.assertEqual(find_duplicates(self.rows), [])


class LoadDatasetTest(unittest.TestCase):
    def test_missing_column(self):
        with tempfile.TemporaryDirectory() as d:
            path = write_csv(d, "a.csv", "text\nhello\n")
            with self.assertRaisesRegex(ValueError, "필요한 열"):
                load_dataset(path)

    def test_unknown_label(self):
        with tempfile.TemporaryDirectory() as d:
            path = write_csv(d, "a.csv", "text,label\n안녕,nope\n")
            with self.assertRaisesRegex(ValueError, "알 수 없는 label"):
                load_dataset(path)

    def test_empty_text(self):
        with tempfile.TemporaryDirectory() as d:
            path = write_csv(d, "a.csv", 'text,label\n"  ",buyer_payment\n')
            with self.assertRaisesRegex(ValueError, "비어 있습니다"):
                load_dataset(path)

    def test_bad_difficulty(self):
        with tempfile.TemporaryDirectory() as d:
            path = write_csv(d, "a.csv", "text,label,difficulty\n안녕,buyer_payment,super\n")
            with self.assertRaisesRegex(ValueError, "difficulty"):
                load_dataset(path, with_difficulty=True)

    def test_missing_file(self):
        with self.assertRaises(FileNotFoundError):
            load_dataset("없는파일.csv")


class OverlapTest(unittest.TestCase):
    def test_detects_same_sentence_ignoring_spacing(self):
        train = [{"text": "환불 언제 되나요", "label": "buyer_cancel_refund"}]
        evals = [{"text": "환불  언제 되나요 ", "label": "buyer_cancel_refund"}]
        self.assertEqual(len(find_overlap(train, evals)), 1)

    def test_no_overlap(self):
        train = [{"text": "환불 언제 되나요", "label": "buyer_cancel_refund"}]
        evals = [{"text": "정산 언제 되나요", "label": "seller_settlement"}]
        self.assertEqual(find_overlap(train, evals), [])


class MetricsTest(unittest.TestCase):
    def setUp(self):
        self.rows = [
            {"text": "a", "label": "buyer_delivery", "difficulty": "easy"},
            {"text": "b", "label": "buyer_delivery", "difficulty": "hard"},
            {"text": "c", "label": "buyer_payment", "difficulty": "easy"},
            {"text": "d", "label": "seller_settlement", "difficulty": "medium"},
        ]
        self.predictions = [
            "buyer_delivery",
            "buyer_payment",  # 배송 -> 결제로 잘못 나눔
            "buyer_payment",
            "seller_settlement",
        ]
        self.result = compute_metrics(self.rows, self.predictions, [0.9, 0.6, 0.8, 0.7])

    def test_overall(self):
        self.assertEqual(self.result["total"], 4)
        self.assertEqual(self.result["correct"], 3)
        self.assertEqual(self.result["accuracy"], 0.75)

    def test_per_label(self):
        self.assertEqual(self.result["per_label"]["buyer_delivery"]["correct"], 1)
        self.assertEqual(self.result["per_label"]["buyer_delivery"]["total"], 2)
        self.assertEqual(self.result["per_label"]["buyer_delivery"]["accuracy"], 0.5)
        self.assertEqual(self.result["per_label"]["buyer_payment"]["accuracy"], 1.0)
        self.assertIsNone(self.result["per_label"]["seller_penalty"]["accuracy"])

    def test_confusion(self):
        self.assertEqual(
            self.result["confusions"],
            [{"true": "buyer_delivery", "predicted": "buyer_payment", "count": 1}],
        )

    def test_wrong_list_and_difficulty(self):
        self.assertEqual(len(self.result["wrong"]), 1)
        self.assertEqual(self.result["wrong"][0]["text"], "b")
        self.assertEqual(self.result["wrong"][0]["confidence"], 0.6)
        self.assertEqual(self.result["per_difficulty"]["hard"]["accuracy"], 0.0)
        self.assertEqual(self.result["per_difficulty"]["easy"]["accuracy"], 1.0)

    def test_length_mismatch(self):
        with self.assertRaises(ValueError):
            compute_metrics(self.rows, ["buyer_delivery"])


class EvaluateGuardTest(unittest.TestCase):
    def test_refuses_when_eval_overlaps_train(self):
        train_text = load_dataset(TRAIN_PATH)[0]["text"]
        with tempfile.TemporaryDirectory() as d:
            path = write_csv(
                d, "eval.csv", f'text,label,difficulty\n"{train_text}",buyer_delivery,easy\n'
            )
            with self.assertRaisesRegex(ValueError, "똑같은 문장"):
                run("v1", eval_path=path, out_path=Path(d) / "out.json")


class ModelTest(unittest.TestCase):
    def test_train_and_predict(self):
        from ml.evaluate import predict
        from ml.train_v1 import train

        with tempfile.TemporaryDirectory() as d:
            bundle, n, saved = train(save_to=Path(d) / "m.joblib")
            self.assertEqual(n, 300)
            self.assertTrue(saved.exists())
            # 학습에 나온 단어가 그대로 들어간 문장으로, 학습과 예측이 이어지는지만 본다.
            # (성능은 평가용 문의로 따로 잰다.)
            rows = [
                {"text": "택배 배송 아직 안 왔어요", "label": "buyer_delivery"},
                {"text": "정산 예정일 알려주세요", "label": "seller_settlement"},
            ]
            predictions, confidences = predict(bundle, rows)
            self.assertEqual(predictions, ["buyer_delivery", "seller_settlement"])
            for c in confidences:
                self.assertTrue(0.0 < c <= 1.0)


@unittest.skipUnless(EVAL_PATH.exists(), "평가용 문의(eval.csv)가 아직 없습니다")
class EvalDataTest(unittest.TestCase):
    def setUp(self):
        self.rows = load_dataset(EVAL_PATH, with_difficulty=True)

    def test_each_label_has_enough(self):
        counts = Counter(r["label"] for r in self.rows)
        for label in LABELS:
            self.assertGreaterEqual(counts[label], 15, f"{label}: {counts[label]}개")

    def test_no_duplicates(self):
        self.assertEqual(find_duplicates(self.rows), [])

    def test_not_in_train(self):
        self.assertEqual(find_overlap(load_dataset(TRAIN_PATH), self.rows), [])


if __name__ == "__main__":
    unittest.main()
