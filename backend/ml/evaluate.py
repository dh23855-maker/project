"""평가 도구: 정답이 달린 평가용 문의로 모델의 분류 성적을 계산한다.

계산하는 것:
  - 전체 정확도 (몇 개 중 몇 개를 맞혔는지)
  - 종류별 정확도
  - 헷갈린 부분 (어떤 종류를 어떤 종류로 잘못 나눴는지)
  - 난이도별 정확도 (평가 파일에 difficulty 열이 있을 때)

실행 (backend 폴더에서):
    .venv\\Scripts\\python.exe -m ml.evaluate
"""
import json
from collections import Counter
from datetime import datetime

from ml.data import (
    BACKEND_DIR,
    EVAL_PATH,
    find_duplicates,
    find_overlap,
    load_dataset,
    load_training_rows,
)
from ml.labels import DIFFICULTIES, LABEL_KO, LABELS

RESULTS_DIR = BACKEND_DIR / "ml" / "results"


def _ratio(correct, total):
    return round(correct / total, 4) if total else None


def compute_metrics(rows, predictions, confidences=None):
    """정답(rows)과 예측(predictions)을 비교해 성적표를 만든다. 모델 없이도 계산된다."""
    if len(rows) != len(predictions):
        raise ValueError("문의 개수와 예측 개수가 다릅니다.")
    confidences = confidences or [None] * len(rows)

    per_label = {label: {"total": 0, "correct": 0} for label in LABELS}
    per_difficulty = {d: {"total": 0, "correct": 0} for d in DIFFICULTIES}
    confusion = Counter()
    wrong = []
    correct_total = 0

    for row, pred, conf in zip(rows, predictions, confidences):
        truth = row["label"]
        ok = pred == truth
        per_label[truth]["total"] += 1
        per_label[truth]["correct"] += ok
        if "difficulty" in row:
            per_difficulty[row["difficulty"]]["total"] += 1
            per_difficulty[row["difficulty"]]["correct"] += ok
        if ok:
            correct_total += 1
        else:
            confusion[(truth, pred)] += 1
            item = {"text": row["text"], "true": truth, "predicted": pred}
            if "difficulty" in row:
                item["difficulty"] = row["difficulty"]
            if conf is not None:
                item["confidence"] = round(float(conf), 4)
            wrong.append(item)

    for stats in list(per_label.values()) + list(per_difficulty.values()):
        stats["accuracy"] = _ratio(stats["correct"], stats["total"])

    has_difficulty = all("difficulty" in r for r in rows)
    return {
        "total": len(rows),
        "correct": correct_total,
        "accuracy": _ratio(correct_total, len(rows)),
        "per_label": per_label,
        "per_difficulty": per_difficulty if has_difficulty else None,
        "confusions": [
            {"true": t, "predicted": p, "count": n} for (t, p), n in confusion.most_common()
        ],
        "wrong": wrong,
    }


def predict(bundle, rows):
    """저장된 모델로 문의마다 예측 종류와 확신도(가장 높은 확률)를 구한다."""
    pipeline = bundle["pipeline"]
    texts = [r["text"] for r in rows]
    probabilities = pipeline.predict_proba(texts)
    best = probabilities.argmax(axis=1)
    predictions = [str(pipeline.classes_[i]) for i in best]
    confidences = [float(probabilities[n][i]) for n, i in enumerate(best)]
    return predictions, confidences


def format_report(result):
    lines = []
    pct = lambda v: "-" if v is None else f"{v * 100:.1f}%"
    lines.append(f"전체 정확도: {result['correct']}/{result['total']} ({pct(result['accuracy'])})")
    lines.append("")
    lines.append("종류별 정확도")
    for label in LABELS:
        s = result["per_label"][label]
        lines.append(f"  {LABEL_KO[label]:<8} {s['correct']:>3}/{s['total']:<3} ({pct(s['accuracy'])})")
    if result["per_difficulty"]:
        lines.append("")
        lines.append("난이도별 정확도")
        for d in DIFFICULTIES:
            s = result["per_difficulty"][d]
            lines.append(f"  {d:<8} {s['correct']:>3}/{s['total']:<3} ({pct(s['accuracy'])})")
    lines.append("")
    lines.append("헷갈린 부분 (실제 → 예측: 개수)")
    if not result["confusions"]:
        lines.append("  없음")
    for c in result["confusions"]:
        lines.append(f"  {LABEL_KO[c['true']]} → {LABEL_KO[c['predicted']]}: {c['count']}개")
    return "\n".join(lines)


def run(eval_path=EVAL_PATH, out_path=None):
    """지금 쓰는 분류 모델 하나를 평가한다."""
    from ml.train import load_model  # scikit-learn이 필요한 부분은 여기서만 불러온다

    eval_rows = load_dataset(eval_path, with_difficulty=True)
    train_rows = load_training_rows()  # 처음 300개 + 보강분. 평가용과 겹치면 안 된다

    dup = find_duplicates(eval_rows)
    if dup:
        raise ValueError(f"평가용 문의에 중복 문장이 {len(dup)}개 있습니다. 예: {dup[0]}")
    overlap = find_overlap(train_rows, eval_rows)
    if overlap:
        raise ValueError(
            f"학습용과 똑같은 문장이 평가용에 {len(overlap)}개 있습니다. "
            f"평가가 부풀려지므로 중단합니다. 예: {overlap[0]}"
        )

    bundle = load_model()
    predictions, confidences = predict(bundle, eval_rows)
    result = compute_metrics(eval_rows, predictions, confidences)
    result.update(
        {
            "description": bundle["description"],
            "evaluated_at": datetime.now().isoformat(timespec="seconds"),
            "train_size": len(train_rows),
            "eval_file": str(eval_path.name if hasattr(eval_path, "name") else eval_path),
        }
    )

    out_path = out_path or RESULTS_DIR / "eval.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result, out_path


if __name__ == "__main__":
    result, out = run()
    print(f"[모델] {result['description']} (학습용 문의 {result['train_size']}개)")
    print(format_report(result))
    print(f"\n결과 저장: {out}")
