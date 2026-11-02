"""학습용·평가용 문의 파일 읽기와 점검."""
import csv
import re
from pathlib import Path

from ml.labels import DIFFICULTIES, LABELS

BACKEND_DIR = Path(__file__).resolve().parent.parent
TRAIN_PATH = BACKEND_DIR / "data" / "train" / "train.csv"
EVAL_PATH = BACKEND_DIR / "data" / "eval" / "eval.csv"


def normalize(text):
    """공백 차이만 있는 같은 문장을 같은 것으로 보기 위한 정리."""
    return re.sub(r"\s+", " ", text).strip()


def load_dataset(path, with_difficulty=False):
    """문의 파일을 읽어 [{'text','label'(,'difficulty')}] 목록으로 돌려준다.

    형식이 틀리면 몇 번째 줄이 왜 틀렸는지 적어서 ValueError를 낸다.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"파일이 없습니다: {path}")

    with path.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        needed = ["text", "label"] + (["difficulty"] if with_difficulty else [])
        missing = [c for c in needed if c not in (reader.fieldnames or [])]
        if missing:
            raise ValueError(f"{path.name}: 필요한 열이 없습니다: {', '.join(missing)}")

        rows = []
        for line_no, row in enumerate(reader, start=2):
            text = normalize(row.get("text") or "")
            label = (row.get("label") or "").strip()
            if not text:
                raise ValueError(f"{path.name} {line_no}번째 줄: 문의 내용이 비어 있습니다.")
            if label not in LABELS:
                raise ValueError(f"{path.name} {line_no}번째 줄: 알 수 없는 label '{label}'")
            item = {"text": text, "label": label}
            if with_difficulty:
                difficulty = (row.get("difficulty") or "").strip()
                if difficulty not in DIFFICULTIES:
                    raise ValueError(
                        f"{path.name} {line_no}번째 줄: 알 수 없는 difficulty '{difficulty}'"
                    )
                item["difficulty"] = difficulty
            rows.append(item)

    if not rows:
        raise ValueError(f"{path.name}: 문의가 하나도 없습니다.")
    return rows


def find_duplicates(rows):
    """한 파일 안에서 같은 문장이 두 번 이상 나오면 그 문장들을 돌려준다."""
    seen, dup = set(), []
    for row in rows:
        key = normalize(row["text"])
        if key in seen:
            dup.append(row["text"])
        seen.add(key)
    return dup


def find_overlap(train_rows, eval_rows):
    """학습용과 평가용에 똑같은 문장이 있으면 그 문장들을 돌려준다."""
    train_texts = {normalize(r["text"]) for r in train_rows}
    return [r["text"] for r in eval_rows if normalize(r["text"]) in train_texts]
