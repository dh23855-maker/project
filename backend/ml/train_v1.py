"""처음 버전 모델: 단어 단위로만 문의를 보는 단순 모델.

실행 (backend 폴더에서):
    .venv\\Scripts\\python.exe -m ml.train_v1
"""
from pathlib import Path

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from ml.data import BACKEND_DIR, TRAIN_PATH, find_duplicates, load_dataset
from ml.labels import LABELS

MODELS_DIR = BACKEND_DIR / "ml" / "models"
VERSION = "v1"
DESCRIPTION = "처음 버전: 띄어쓰기로 나뉜 단어 단위 TF-IDF + 로지스틱 회귀"


def build_pipeline():
    return Pipeline(
        [
            ("tfidf", TfidfVectorizer(analyzer="word")),
            ("clf", LogisticRegression(C=10.0, max_iter=1000)),
        ]
    )


def model_path(version=VERSION):
    return MODELS_DIR / f"{version}.joblib"


def load_model(version=VERSION):
    """저장된 모델과 설명을 불러온다."""
    path = model_path(version)
    if not path.exists():
        raise FileNotFoundError(f"모델 파일이 없습니다: {path} (먼저 학습을 실행하세요)")
    return joblib.load(path)


def train(train_path=TRAIN_PATH, save_to=None):
    rows = load_dataset(train_path)
    dup = find_duplicates(rows)
    if dup:
        raise ValueError(f"학습용 문의에 중복 문장이 {len(dup)}개 있습니다. 예: {dup[0]}")

    pipeline = build_pipeline()
    pipeline.fit([r["text"] for r in rows], [r["label"] for r in rows])
    assert sorted(pipeline.classes_) == sorted(LABELS)

    bundle = {"version": VERSION, "description": DESCRIPTION, "pipeline": pipeline}
    save_to = Path(save_to) if save_to else model_path()
    save_to.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, save_to)
    return bundle, len(rows), save_to


if __name__ == "__main__":
    _, n, path = train()
    print(f"학습 완료: 문의 {n}개로 '{VERSION}' 모델을 만들었습니다.")
    print(f"저장 위치: {path}")
