"""서버에서 쓰는 문의 분류기. ml 폴더에서 학습한 모델을 불러온다."""
from ml.train_v1 import load_model

# 지금 서버가 쓰는 모델 버전. 5일차에 고친 버전을 만들면 여기만 바꾼다.
ACTIVE_VERSION = "v1"


class Classifier:
    def __init__(self, version=ACTIVE_VERSION):
        try:
            self._bundle = load_model(version)
        except FileNotFoundError as e:
            raise RuntimeError(
                f"{e}\n   backend 폴더에서 `.venv\\Scripts\\python.exe -m ml.train_v1` 을 먼저 실행하세요."
            ) from e
        self._pipeline = self._bundle["pipeline"]
        self.version = self._bundle["version"]

    def classify(self, text):
        """(종류, 확신도 0~1)을 돌려준다."""
        probabilities = self._pipeline.predict_proba([text])[0]
        best = int(probabilities.argmax())
        return str(self._pipeline.classes_[best]), float(probabilities[best])
