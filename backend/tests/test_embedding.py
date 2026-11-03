"""임베딩 호출 시험: OpenAI를 가짜로 대신해 저장·재사용·문의 비저장을 확인한다."""
import tempfile
import unittest
from pathlib import Path

import numpy as np

from app.config import Settings
from app.embedding import EMBED_MODEL, Embedder
from app.policy import make_policy


class _Item:
    def __init__(self, embedding):
        self.embedding = embedding


class _Response:
    def __init__(self, vectors):
        self.data = [_Item(v) for v in vectors]


class _Embeddings:
    def __init__(self):
        self.requests = []

    def create(self, model, input):
        self.requests.append((model, list(input)))
        return _Response([[float(len(t)), 1.0, 0.0] for t in input])


class _Client:
    def __init__(self):
        self.embeddings = _Embeddings()


class EmbedderTest(unittest.TestCase):
    def test_vectors_have_length_one(self):
        embedder = Embedder(_Client())
        matrix = embedder.embed(["가나다", "가"])
        self.assertTrue(np.allclose(np.linalg.norm(matrix, axis=1), 1.0))
        self.assertAlmostEqual(float(np.linalg.norm(embedder.embed_query("문의"))), 1.0)

    def test_same_text_is_requested_once_and_reused(self):
        client = _Client()
        embedder = Embedder(client)
        embedder.embed(["가", "나", "가"])
        embedder.embed(["가", "나"])
        self.assertEqual(len(client.embeddings.requests), 1)
        self.assertEqual(client.embeddings.requests[0][1], ["가", "나"])

    def test_saved_file_is_reused_by_a_new_embedder(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "cache.json"
            first = Embedder(_Client(), "m", path)
            first.embed(["가", "나"])
            self.assertTrue(path.exists())
            client = _Client()
            Embedder(client, "m", path).embed(["가", "나"])
            self.assertEqual(client.embeddings.requests, [])
            # 모델이 다르면 다른 벡터이므로 다시 부른다
            other = _Client()
            Embedder(other, "다른모델", path).embed(["가"])
            self.assertEqual(len(other.embeddings.requests), 1)

    def test_customer_questions_are_never_saved(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "cache.json"
            embedder = Embedder(_Client(), "m", path)
            embedder.embed(["조항 글"])
            embedder.embed_query("개인 정보가 들어 있을 수 있는 고객 문의")
            self.assertNotIn("고객 문의", path.read_text(encoding="utf-8"))
            self.assertEqual(len(embedder.cache), 1)

    def test_broken_cache_file_is_ignored(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "cache.json"
            path.write_text("{깨진 파일", encoding="utf-8")
            with self.assertLogs("app.embedding", level="WARNING"):
                embedder = Embedder(_Client(), "m", path)
            self.assertEqual(embedder.cache, {})

    def test_large_batches_are_split(self):
        client = _Client()
        Embedder(client).embed([f"글{n}" for n in range(300)])
        self.assertEqual([len(r[1]) for r in client.embeddings.requests], [128, 128, 44])


class MakePolicyTest(unittest.TestCase):
    def test_without_an_api_key_only_tfidf_is_used(self):
        settings = Settings(database_url="x", session_secret="y", frontend_origin="z")
        self.assertFalse(make_policy(settings).uses_embedding)

    def test_default_model_is_the_one_chosen_by_the_comparison(self):
        self.assertEqual(EMBED_MODEL, "text-embedding-3-large")


if __name__ == "__main__":
    unittest.main()
