"""Phase 5 시험: 성능 평가 실행, 결과 저장, 이전 실행 보기.

임시 DB 영역에서 돌고, 평가에는 진짜 분류 모델과 진짜 평가용 파일(data/eval/eval.csv)을 쓴다.
정확한 숫자를 확인하는 시험은 정답을 아는 작은 가짜 모델과 작은 파일을 쓴다.
"""
import csv
import tempfile
from pathlib import Path

import numpy as np

from app import evaluation
from ml.data import EVAL_PATH, load_training_rows
from ml.labels import LABELS
from tests.base import ApiTestBase


class FakePipeline:
    """문의 글 안의 [예측:종류]를 그대로 예측으로 돌려주는 가짜 모델 (없으면 배송으로 예측)."""

    classes_ = np.array(LABELS)

    def predict_proba(self, texts):
        out = np.full((len(texts), len(LABELS)), 0.01)
        for n, text in enumerate(texts):
            predicted = text.split("[예측:")[1].split("]")[0] if "[예측:" in text else "buyer_delivery"
            out[n][LABELS.index(predicted)] = 0.94
        return out


class FakeClassifier:
    description = "가짜 모델"
    bundle = {"pipeline": FakePipeline(), "description": "가짜 모델"}

    def classify(self, text):
        raise AssertionError("평가는 문의 하나씩 분류하는 길을 쓰지 않는다")


def write_eval(path, rows):
    with open(path, "w", encoding="utf-8-sig", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["text", "label", "difficulty"])
        writer.writerows(rows)


class EvaluationTest(ApiTestBase):
    def eval_run_count(self):
        with self.connect() as conn:
            return conn.execute("SELECT count(*) AS n FROM eval_runs").fetchone()["n"]

    def inquiry_count(self):
        with self.connect() as conn:
            return conn.execute("SELECT count(*) AS n FROM inquiries").fetchone()["n"]

    def setUp(self):
        super().setUp()
        self.restore()

    def tearDown(self):
        self.restore()

    def restore(self):
        self.app.state.eval_path = EVAL_PATH
        self.app.state.classifier = self.classifier

    # --- 로그인 -------------------------------------------------------------

    def test_login_is_required(self):
        client = self.new_client()
        self.assertEqual(client.get("/api/evaluations").status_code, 401)
        self.assertEqual(client.get("/api/evaluations/1").status_code, 401)
        before = self.eval_run_count()
        self.assertEqual(client.post("/api/evaluations").status_code, 401)
        self.assertEqual(self.eval_run_count(), before)

    # --- 실행: 진짜 모델과 진짜 평가 파일 -----------------------------------------

    def test_run_matches_a_separate_count_over_the_eval_file(self):
        kim = self.login("kim")
        response = kim.post("/api/evaluations")
        self.assertEqual(response.status_code, 201, response.text)
        run = response.json()

        with open(EVAL_PATH, encoding="utf-8-sig", newline="") as f:
            rows = list(csv.DictReader(f))
        # 한 문의씩 분류하는 다른 길로 따로 센다
        correct = sum(self.classifier.classify(r["text"])[0] == r["label"].strip() for r in rows)
        self.assertEqual(run["total"], len(rows))
        self.assertEqual(run["correct"], correct)
        self.assertAlmostEqual(run["accuracy"], correct / len(rows), places=3)

        # 종류별 합계, 헷갈린 부분, 틀린 문의 목록이 서로 맞는다
        self.assertEqual([l["key"] for l in run["labels"]], LABELS)
        self.assertEqual(set(run["per_label"]), set(LABELS))
        self.assertEqual(sum(s["total"] for s in run["per_label"].values()), run["total"])
        self.assertEqual(sum(s["correct"] for s in run["per_label"].values()), run["correct"])
        wrong = run["total"] - run["correct"]
        self.assertEqual(sum(c["count"] for c in run["confusions"]), wrong)
        self.assertEqual(len(run["wrong"]), wrong)
        for item in run["wrong"]:
            self.assertNotEqual(item["true"], item["predicted"])
        self.assertEqual(sum(s["total"] for s in run["per_difficulty"].values()), run["total"])
        self.assertEqual(run["run_by_name"], "김상담")
        self.assertTrue(run["description"])

    def test_every_run_is_saved_and_old_runs_can_be_viewed(self):
        kim, park = self.login("kim"), self.login("park")
        before = self.eval_run_count()
        first = kim.post("/api/evaluations").json()
        second = park.post("/api/evaluations").json()  # 다른 상담사도 실행할 수 있다
        self.assertEqual(self.eval_run_count(), before + 2)
        self.assertNotEqual(first["id"], second["id"])
        self.assertEqual(second["run_by_name"], "박상담")

        listed = kim.get("/api/evaluations").json()
        ids = [r["id"] for r in listed]
        self.assertEqual(ids[:2], [second["id"], first["id"]])  # 최근 실행이 위
        self.assertEqual(listed[1]["correct"], first["correct"])
        self.assertNotIn("per_label", listed[0])  # 목록은 요약만

        again = park.get(f"/api/evaluations/{first['id']}").json()  # 이전 결과를 그대로 다시 본다
        self.assertEqual(again, first)

    def test_unknown_run_is_404(self):
        self.assertEqual(self.login().get("/api/evaluations/99999999").status_code, 404)

    def test_evaluation_questions_never_enter_the_inquiry_list(self):
        kim = self.login("kim")
        before = self.inquiry_count()
        listed_before = [i["id"] for i in kim.get("/api/inquiries").json()]
        kim.post("/api/evaluations")
        self.assertEqual(self.inquiry_count(), before)
        self.assertEqual([i["id"] for i in kim.get("/api/inquiries").json()], listed_before)
        self.assertEqual(self.drafter.calls, [])  # 평가는 OpenAI를 부르지 않는다

    # --- 실행: 정확한 숫자 (정답을 아는 작은 묶음) --------------------------------

    def test_exact_numbers_with_a_tiny_known_set(self):
        rows = [
            ("배송 문의 하나 [예측:buyer_delivery]", "buyer_delivery", "easy"),
            ("배송 문의 둘 [예측:buyer_delivery]", "buyer_delivery", "easy"),
            ("배송인데 결제로 [예측:buyer_payment]", "buyer_delivery", "hard"),
            ("정산 문의 하나 [예측:seller_settlement]", "seller_settlement", "medium"),
            ("정산인데 페널티로 [예측:seller_penalty]", "seller_settlement", "hard"),
            ("정산인데 페널티로 또 [예측:seller_penalty]", "seller_settlement", "hard"),
        ]
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "tiny.csv"
            write_eval(path, rows)
            self.app.state.eval_path = path
            self.app.state.classifier = FakeClassifier()
            run = self.login("kim").post("/api/evaluations").json()

        self.assertEqual((run["total"], run["correct"]), (6, 3))
        self.assertEqual(run["accuracy"], 0.5)
        self.assertEqual(run["per_label"]["buyer_delivery"], {"total": 3, "correct": 2, "accuracy": 0.6667})
        self.assertEqual(run["per_label"]["seller_settlement"], {"total": 3, "correct": 1, "accuracy": 0.3333})
        self.assertEqual(run["per_label"]["buyer_payment"], {"total": 0, "correct": 0, "accuracy": None})
        self.assertEqual(
            run["confusions"],
            [
                {"true": "seller_settlement", "predicted": "seller_penalty", "count": 2},
                {"true": "buyer_delivery", "predicted": "buyer_payment", "count": 1},
            ],
        )
        self.assertEqual(run["per_difficulty"]["hard"], {"total": 3, "correct": 0, "accuracy": 0.0})
        self.assertEqual(run["per_difficulty"]["easy"], {"total": 2, "correct": 2, "accuracy": 1.0})
        self.assertEqual({w["difficulty"] for w in run["wrong"]}, {"hard"})

    # --- 실패 ---------------------------------------------------------------

    def test_missing_eval_file_gives_a_message_and_saves_nothing(self):
        before = self.eval_run_count()
        self.app.state.eval_path = Path(tempfile.gettempdir()) / "없는_평가_파일.csv"
        response = self.login().post("/api/evaluations")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["detail"], evaluation.NOT_READY_MESSAGE)
        self.assertEqual(self.eval_run_count(), before)

    def test_broken_or_empty_eval_file_is_treated_as_not_ready(self):
        before = self.eval_run_count()
        with tempfile.TemporaryDirectory() as folder:
            empty = Path(folder) / "empty.csv"
            write_eval(empty, [])
            bad_label = Path(folder) / "bad.csv"
            write_eval(bad_label, [("문의 [예측:buyer_delivery]", "없는종류", "easy")])
            for path in (empty, bad_label):
                self.app.state.eval_path = path
                response = self.login().post("/api/evaluations")
                self.assertEqual(response.status_code, 409, path.name)
                self.assertEqual(response.json()["detail"], evaluation.NOT_READY_MESSAGE)
        self.assertEqual(self.eval_run_count(), before)

    def test_error_during_the_run_saves_no_half_result(self):
        class Broken(FakeClassifier):
            @property
            def bundle(self):
                raise RuntimeError("모델 오류")

        before = self.eval_run_count()
        self.app.state.classifier = Broken()
        with self.assertLogs("app.evaluation", level="ERROR"):
            response = self.login().post("/api/evaluations")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.json()["detail"], evaluation.RUN_FAIL_MESSAGE)
        self.assertEqual(self.eval_run_count(), before)

    def test_eval_question_copied_from_training_stops_the_run(self):
        # 학습용과 똑같은 문장이 평가용에 있으면 점수가 부풀려지므로 저장하지 않고 중단한다
        copied = load_training_rows()[0]
        before = self.eval_run_count()
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "leak.csv"
            write_eval(path, [(copied["text"], copied["label"], "easy")])
            self.app.state.eval_path = path
            self.app.state.classifier = FakeClassifier()
            with self.assertLogs("app.evaluation", level="ERROR"):
                response = self.login().post("/api/evaluations")
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.eval_run_count(), before)
