"""문의 분류 모델: 글자 조각(2~3글자) TF-IDF + 로지스틱 회귀.

학습용 문의만 쓰는 교차 검증(5등분 번갈아 시험)으로 여러 방식을 비교해 고른 방식이다.
- 띄어쓰기 단위 단어 방식: 74%  ("정산금이"를 "정산"과 다른 말로 봄)
- 글자 조각 2~3글자 방식: 88% ("정산금이"에서 "정산"을 알아봄)
평가용 문의는 방식을 고르는 데 쓰지 않았다.

실행 (backend 폴더에서):
    .venv\\Scripts\\python.exe -m ml.train
"""
from pathlib import Path

import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline

from ml.data import BACKEND_DIR, load_training_rows
from ml.labels import LABELS

MODELS_DIR = BACKEND_DIR / "ml" / "models"
MODEL_NAME = "classifier"
DESCRIPTION = "글자 조각(2~3글자) TF-IDF + 로지스틱 회귀(C=50)"


def build_pipeline():
    return Pipeline(
        [
            ("tfidf", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 3), sublinear_tf=True)),
            ("clf", LogisticRegression(C=50.0, max_iter=3000)),
        ]
    )


def model_path():
    return MODELS_DIR / f"{MODEL_NAME}.joblib"


def load_model():
    """저장된 모델과 설명을 불러온다."""
    path = model_path()
    if not path.exists():
        raise FileNotFoundError(f"모델 파일이 없습니다: {path} (먼저 학습을 실행하세요)")
    return joblib.load(path)


def train(rows=None, save_to=None):
    """학습용 문의(처음 300개 + 보강분)로 모델을 만들어 저장한다."""
    rows = rows if rows is not None else load_training_rows()

    pipeline = build_pipeline()
    pipeline.fit([r["text"] for r in rows], [r["label"] for r in rows])
    assert sorted(pipeline.classes_) == sorted(LABELS)

    bundle = {"description": DESCRIPTION, "trained_on": len(rows), "pipeline": pipeline}
    save_to = Path(save_to) if save_to else model_path()
    save_to.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, save_to)
    return bundle, len(rows), save_to


if __name__ == "__main__":
    _, n, path = train()
    print(f"학습 완료: 문의 {n}개로 모델을 만들었습니다.")
    print(f"방식: {DESCRIPTION}")
    print(f"저장 위치: {path}")
