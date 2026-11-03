"""규정 문서를 찾는 방식 비교: TF-IDF / 임베딩 / 둘을 섞은 방식.

같은 정답 표(data/eval/retrieval_gold.csv)로 세 방식을 재서 가장 좋은 방식을 고른다.
- 지표: 1등 안(hit@1), 3등 안(hit@3), MRR. 정답 조항이 하나라도 맞으면 성공이고, 정답이 있는 문의만 센다.
- 조건: 분류가 맞다고 가정한 경우(그 종류의 후보 안에서)와 정책 전체에서 찾는 경우(확신도가 낮을 때),
  조항의 '이런 문의에 쓰임' 줄을 포함한 경우와 제외한 경우.
- 임베딩 결과는 results/embedding_cache.json에 저장해 두고 다시 쓴다 (같은 글자는 다시 부르지 않는다).

실행: backend 폴더에서  python -m ml.retrieval_compare
"""
import json
import sys

import numpy as np

from app.embedding import EMBED_MODEL, Embedder
from app.policy import POLICY_PATH, PolicyBook
from ml.data import BACKEND_DIR
from ml.retrieval_data import load_gold

CACHE_PATH = BACKEND_DIR / "ml" / "results" / "embedding_cache.json"
RESULT_DIR = BACKEND_DIR / "ml" / "results"
MIX_WEIGHT = 0.5  # 섞는 방식에서 TF-IDF 점수의 비중. 결과를 보고 고르지 않고 미리 정했다.
EXAMPLE_PREFIX = "- 이런 문의에 쓰임:"


def _minmax(values):
    values = np.asarray(values, dtype=float)
    low, high = values.min(), values.max()
    return np.zeros_like(values) if high - low < 1e-12 else (values - low) / (high - low)


class Retrievers:
    """한 가지 조건(예시 줄 포함/제외)의 조항 모음 위에서 세 방식으로 순위를 매긴다."""

    def __init__(self, book, embedder):
        self.book, self.embedder = book, embedder
        self.clause_vectors = embedder.embed([c.search_text for c in book.clauses])
        self.index = {c.id: n for n, c in enumerate(book.clauses)}

    def rank(self, method, label, text):
        candidates = self.book.clauses if label is None else self.book.candidates(label)
        if not candidates or not text.strip():
            return []
        tfidf = {c.id: s for c, s in self.book.scores(label, text)}
        query = self.embedder.embed([text])[0]  # 비교용이라 문의 벡터도 저장해 다시 쓴다
        embed = {c.id: float(self.clause_vectors[self.index[c.id]] @ query) for c in candidates}
        ids = [c.id for c in candidates]
        if method == "tfidf":
            score = tfidf
        elif method == "embedding":
            score = embed
        elif method == "mixed":
            a, b = _minmax([tfidf[i] for i in ids]), _minmax([embed[i] for i in ids])
            score = {i: MIX_WEIGHT * x + (1 - MIX_WEIGHT) * y for i, x, y in zip(ids, a, b)}
        else:
            raise ValueError(method)
        return sorted(ids, key=lambda i: -score[i])


def measure(rows, ranker):
    """정답이 있는 문의만 세어 hit@1, hit@3, MRR을 돌려준다."""
    hit1 = hit3 = mrr = 0.0
    used = [r for r in rows if r["gold"]]
    for r in used:
        ranked = ranker(r)
        gold = set(r["gold"])
        hit1 += bool(gold & set(ranked[:1]))
        hit3 += bool(gold & set(ranked[:3]))
        first = next((n for n, i in enumerate(ranked, start=1) if i in gold), None)
        mrr += 1 / first if first else 0.0
    n = len(used)
    return {"n": n, "hit1": hit1 / n, "hit3": hit3 / n, "mrr": mrr / n}


def run(client, model=EMBED_MODEL):
    text = POLICY_PATH.read_text(encoding="utf-8")
    plain = "\n".join(line for line in text.splitlines() if not line.startswith(EXAMPLE_PREFIX))
    books = {"예시 줄 포함": PolicyBook(text=text), "예시 줄 제외": PolicyBook(text=plain)}
    embedder = Embedder(client, model, CACHE_PATH)
    rows = load_gold(books["예시 줄 포함"])
    results = {}
    for variant, book in books.items():
        retrievers = Retrievers(book, embedder)
        for scope, use_label in (("분류가 맞을 때(그 종류 안에서)", True), ("정책 전체에서", False)):
            for method in ("tfidf", "embedding", "mixed"):
                key = f"{variant} | {scope} | {method}"
                results[key] = measure(rows, lambda r: retrievers.rank(method, r["label"] if use_label else None, r["text"]))
                by_difficulty = {}
                for d in ("easy", "medium", "hard"):
                    sub = [r for r in rows if r["difficulty"] == d]
                    by_difficulty[d] = measure(sub, lambda r: retrievers.rank(method, r["label"] if use_label else None, r["text"]))
                results[key]["by_difficulty"] = by_difficulty
    return {"model": model, "mix_weight": MIX_WEIGHT, "results": results}


def main():
    from openai import OpenAI

    from app.config import load_settings

    settings = load_settings()
    model = sys.argv[1] if len(sys.argv) > 1 else EMBED_MODEL
    report = run(OpenAI(api_key=settings.openai_api_key, timeout=60), model)
    RESULT_DIR.mkdir(parents=True, exist_ok=True)
    (RESULT_DIR / f"retrieval_compare_{model}.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"임베딩 모델: {model}, 섞는 비율(TF-IDF): {MIX_WEIGHT}")
    for key, m in report["results"].items():
        print(f"{key:55s} 1등 안 {m['hit1']:.1%}  3등 안 {m['hit3']:.1%}  MRR {m['mrr']:.3f}")


if __name__ == "__main__":
    main()
