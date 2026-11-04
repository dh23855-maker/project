"""비슷한 지난 문의 찾기: 처리 완료된 문의 중 지금 문의와 뜻이 비슷한 것과 그 최종 답장을 보여 준다.

상담사가 답장을 고치거나 직접 쓸 때 참고하는 용도다. 규정 문서 찾기와 같은 방식(임베딩, 안 되면 TF-IDF)을 쓰되,
문의 벡터는 파일에 저장하지 않고 서버 메모리에만 둔다 (고객 문의를 파일에 남기지 않기 위해서다).
"""
import logging

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from ml.labels import LABEL_KO

logger = logging.getLogger(__name__)

MAX_SIMILAR = 3
# 최소 유사도: 이보다 낮으면 "비슷하다"고 보여 주지 않는다.
# 실제 문의 43건끼리(903쌍)의 점수로 정했다 (docs/plan.md "비슷한 지난 문의 기준" 참고).
# 임베딩: 같은 종류끼리 중간값 0.41, 다른 종류끼리 90%가 0.39 이하. 0.45면 다른 종류는 3.5%만 걸린다.
EMBEDDING_MIN_SIMILARITY = 0.45
# TF-IDF(임베딩을 못 쓸 때만): 같은 종류의 12%, 다른 종류의 1.6%가 0.15 이상이다.
TFIDF_MIN_SIMILARITY = 0.15


class SimilarFinder:
    """embedder가 없거나 호출에 실패하면 글자 조각(TF-IDF)으로 찾는다."""

    def __init__(self, embedder=None):
        self.embedder = embedder

    def _scores(self, target, bodies):
        """(유사도 목록, 최소 유사도). 뜻 비교가 안 되면 TF-IDF."""
        if self.embedder is not None:
            try:
                vectors = self.embedder.embed(bodies)  # 같은 글은 메모리에 두고 다시 부르지 않는다
                return [float(s) for s in vectors @ self.embedder.embed_query(target)], EMBEDDING_MIN_SIMILARITY
            except Exception:
                logger.exception("비슷한 문의를 임베딩으로 찾지 못해 이번에는 TF-IDF로 찾습니다")
        vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 3), sublinear_tf=True)
        matrix = vectorizer.fit_transform(bodies + [target])
        return [float(s) for s in cosine_similarity(matrix[-1], matrix[:-1])[0]], TFIDF_MIN_SIMILARITY

    def find(self, conn, inquiry_id, limit=MAX_SIMILAR):
        """비슷한 순으로 처리 완료 문의를 최대 limit개. 문의가 없으면 None."""
        row = conn.execute("SELECT body FROM inquiries WHERE id = %s", (inquiry_id,)).fetchone()
        if row is None:
            return None
        candidates = conn.execute(
            "SELECT id, body, predicted_label, final_reply, resolved_at FROM inquiries"
            " WHERE status = 'done' AND final_reply IS NOT NULL AND id <> %s ORDER BY id",
            (inquiry_id,),
        ).fetchall()
        if not candidates:
            return []
        scores, minimum = self._scores(row["body"], [c["body"] for c in candidates])
        ranked = sorted(zip(candidates, scores), key=lambda p: (-p[1], -p[0]["id"]))
        return [
            {
                "id": c["id"],
                "body": c["body"],
                "predicted_label_ko": LABEL_KO.get(c["predicted_label"]),
                "final_reply": c["final_reply"],
                "resolved_at": c["resolved_at"],
                "similarity_percent": round(score * 100, 1),
            }
            for c, score in ranked
            if score >= minimum
        ][:limit]


def make_similar_finder(settings):
    """OpenAI 키가 있으면 뜻으로 찾는다. 벡터는 파일 없이 메모리에만 둔다."""
    if not settings.openai_api_key:
        return SimilarFinder()
    from openai import OpenAI

    from app.embedding import EMBED_MODEL, Embedder

    client = OpenAI(api_key=settings.openai_api_key, timeout=30, max_retries=1)
    return SimilarFinder(Embedder(client, settings.openai_embedding_model or EMBED_MODEL))
