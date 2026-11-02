"""서버에서 쓰는 문의 분류기. ml 폴더에서 학습한 모델을 불러온다."""
from ml.train import load_model


class Classifier:
    def __init__(self):
        try:
            self._bundle = load_model()
        except FileNotFoundError as e:
            raise RuntimeError(
                f"{e}\n   backend 폴더에서 `.venv\\Scripts\\python.exe -m ml.train` 을 먼저 실행하세요."
            ) from e
        self._pipeline = self._bundle["pipeline"]
        self.description = self._bundle["description"]

    def classify(self, text):
        """(종류, 확신도 0~1)을 돌려준다."""
        probabilities = self._pipeline.predict_proba([text])[0]
        best = int(probabilities.argmax())
        return str(self._pipeline.classes_[best]), float(probabilities[best])
