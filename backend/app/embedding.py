"""OpenAI 임베딩: 글을 '뜻 숫자 목록'(벡터)으로 바꿔 규정 문서를 뜻으로 찾는 데 쓴다.

조항 벡터는 파일에 저장해 두고 다시 쓴다 (글이 같으면 다시 부르지 않는다).
문의 벡터는 저장하지 않는다 (고객 문의를 파일에 남기지 않기 위해서다).
"""
import hashlib
import json
import logging
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

# 같은 정답 표로 TF-IDF·임베딩·섞기를 비교해 고른 모델 (docs/plan.md "규정 문서 찾는 방식 비교" 참고)
EMBED_MODEL = "text-embedding-3-large"


def _key(model, text):
    return hashlib.sha256(f"{model}\n{text}".encode("utf-8")).hexdigest()


def _normalize(matrix):
    matrix = np.asarray(matrix, dtype=float)
    return matrix / np.linalg.norm(matrix, axis=-1, keepdims=True)


class Embedder:
    """OpenAI 임베딩 호출. client는 openai.OpenAI(시험에서는 가짜)."""

    def __init__(self, client, model=EMBED_MODEL, cache_path=None):
        self.client, self.model = client, model
        self.cache_path = Path(cache_path) if cache_path else None
        self.cache = {}
        if self.cache_path and self.cache_path.exists():
            try:
                self.cache = json.loads(self.cache_path.read_text(encoding="utf-8"))
            except ValueError:
                logger.warning("임베딩 저장 파일을 읽지 못해 새로 만듭니다: %s", self.cache_path)
        self.calls = 0

    def _request(self, texts):
        response = self.client.embeddings.create(model=self.model, input=texts)
        self.calls += 1
        return [item.embedding for item in response.data]

    def embed(self, texts):
        """조항처럼 오래 쓰는 글의 벡터 (파일에 저장). 길이를 1로 맞춘 행렬을 돌려준다."""
        missing = [t for t in dict.fromkeys(texts) if _key(self.model, t) not in self.cache]
        for start in range(0, len(missing), 128):
            batch = missing[start : start + 128]
            for text, vector in zip(batch, self._request(batch)):
                self.cache[_key(self.model, text)] = vector
        if missing and self.cache_path:
            self.cache_path.parent.mkdir(parents=True, exist_ok=True)
            self.cache_path.write_text(json.dumps(self.cache), encoding="utf-8")
        return _normalize([self.cache[_key(self.model, t)] for t in texts])

    def embed_query(self, text):
        """고객 문의 한 개의 벡터. 저장하지 않는다."""
        return _normalize(self._request([text])[0])
