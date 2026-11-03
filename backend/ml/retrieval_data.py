"""규정 문서 찾기 정답 표 읽기와 점검.

`data/eval/retrieval_gold.csv`는 평가용 문의 140개 각각에 "이 문의에 답하려면 어떤 규정 조항이 필요한가"를 붙인 표다.
찾는 방식(TF-IDF, 임베딩, 섞기)을 같은 기준으로 비교할 때만 쓴다. 분류 모델 학습에는 쓰지 않는다.
"""
import csv
from pathlib import Path

from ml.data import BACKEND_DIR, normalize
from ml.labels import DIFFICULTIES, LABELS

GOLD_PATH = BACKEND_DIR / "data" / "eval" / "retrieval_gold.csv"
COVERAGES = ("full", "partial", "none")  # 규정 문서가 문의에 충분히 답함 / 일부만 답함 / 관련 규정이 없음


def load_gold(policy, path=GOLD_PATH):
    """[{'eval_row','text','label','difficulty','gold'(조항 ID 목록),'coverage'}]를 돌려준다.

    형식이 틀리면 몇 번째 줄이 왜 틀렸는지 적어서 ValueError를 낸다.
    - 정답 조항은 모두 규정 문서에 있는 번호여야 한다.
    - coverage가 none이면 정답 조항이 없어야 하고, 아니면 하나 이상 있어야 한다.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"파일이 없습니다: {path}")
    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        needed = ["eval_row", "text", "label", "difficulty", "gold", "coverage"]
        missing = [c for c in needed if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{path.name}: 필요한 열이 없습니다: {', '.join(missing)}")
        rows = []
        for line_no, row in enumerate(reader, start=2):
            text = normalize(row["text"] or "")
            if not text:
                raise ValueError(f"{path.name} {line_no}번째 줄: 문의 내용이 비어 있습니다.")
            if row["label"] not in LABELS:
                raise ValueError(f"{path.name} {line_no}번째 줄: 알 수 없는 label '{row['label']}'")
            if row["difficulty"] not in DIFFICULTIES:
                raise ValueError(f"{path.name} {line_no}번째 줄: 알 수 없는 difficulty '{row['difficulty']}'")
            coverage = row["coverage"]
            if coverage not in COVERAGES:
                raise ValueError(f"{path.name} {line_no}번째 줄: 알 수 없는 coverage '{coverage}'")
            gold = (row["gold"] or "").split()
            unknown = [g for g in gold if not policy.exists(g)]
            if unknown:
                raise ValueError(f"{path.name} {line_no}번째 줄: 규정 문서에 없는 조항 번호 {unknown}")
            if len(set(gold)) != len(gold):
                raise ValueError(f"{path.name} {line_no}번째 줄: 정답 조항이 중복됩니다: {gold}")
            if (coverage == "none") != (not gold):
                raise ValueError(f"{path.name} {line_no}번째 줄: coverage가 none이면 정답 조항이 없어야 하고, 아니면 있어야 합니다.")
            rows.append(
                {
                    "eval_row": int(row["eval_row"]),
                    "text": text,
                    "label": row["label"],
                    "difficulty": row["difficulty"],
                    "gold": gold,
                    "coverage": coverage,
                }
            )
    if not rows:
        raise ValueError(f"{path.name}: 문의가 하나도 없습니다.")
    return rows
