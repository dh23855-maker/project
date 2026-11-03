"""정책 문서 읽기와 근거 조항 찾기.

정책 문서(backend/policies/policy_clauses.md)는 `### [ID] 제목 [라벨]` 단위로 조항을 나눈다.
- 일반 줄과 표는 고객 안내의 근거가 되는 내용이다.
- `- 응대 주의:` 줄은 초안을 쓸 때만 쓰는 내부 지침이다. 고객 화면의 근거 원문에는 넣지 않는다.
"""
import re
from dataclasses import dataclass, field
from pathlib import Path

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from app.config import PROJECT_DIR

POLICY_PATH = PROJECT_DIR / "backend" / "policies" / "policy_clauses.md"

# 분류된 문의 종류 -> 정책 문서의 '의도 → 조항 매핑' 표에서 부르는 이름
LABEL_TO_INTENT = {
    "buyer_delivery": "구매자-배송",
    "buyer_inspection_result": "구매자-검수 결과",
    "buyer_cancel_refund": "구매자-취소·환불",
    "buyer_payment": "구매자-결제·포인트",
    "seller_inspection_fail": "판매자-검수 불합격·반송",
    "seller_penalty": "판매자-페널티",
    "seller_settlement": "판매자-정산",
}

MAX_EVIDENCE = 3
# 모델에게 보여줄 후보 조항의 최소 유사도. 글자 유사도만으로는 '답이 있는 문의'와 '엉뚱한 조항에 걸린 문의'를
# 가르기 어렵다. 그래서 이 기준은 확실히 상관없는 조항만 걸러 내는 낮은 값으로 두고(0.12는 답이 있는 문의 일부를
# 놓쳤다), 후보 조항 중 실제로 쓸 것과 "근거 조항에는 없음"의 판단은 모델(drafting.py의 cited, uncovered)에게
# 맡기고, 돌려받은 번호는 프로그램이 다시 확인한다.
MIN_SIMILARITY = 0.06

CAUTION_PREFIX = "- 응대 주의:"
_HEADER = re.compile(r"^### \[(?P<id>[A-Z]+-\d+)\] (?P<title>.*?)\s*\[(?P<label>[^\]]+)\]\s*$")
_ID_RANGE = re.compile(r"([A-Z]+)-(\d+)(?:~(\d+))?")


@dataclass(frozen=True)
class Clause:
    id: str
    title: str
    label: str
    content: str  # 고객 안내의 근거가 되는 내용 (응대 주의 줄은 뺀 것)
    cautions: tuple = field(default_factory=tuple)  # 응대 주의 줄들 (접두어 제거)

    @property
    def legacy(self):
        """구버전 기준을 바탕으로 한 조항인지."""
        return self.label.startswith("구버전")

    @property
    def search_text(self):
        return f"{self.title}\n{self.content}"

    def to_dict(self):
        return {
            "id": self.id,
            "title": self.title,
            "label": self.label,
            "legacy": self.legacy,
            "content": self.content,
        }


class PolicyError(ValueError):
    """정책 문서 형식이 틀렸을 때."""


def _expand_ids(text):
    ids = []
    for m in _ID_RANGE.finditer(text):
        prefix, start, end = m.group(1), int(m.group(2)), m.group(3)
        for n in range(start, int(end or start) + 1):
            ids.append(f"{prefix}-{n:02d}")
    return ids


def parse_policy(text):
    """정책 문서 전체를 읽어 (조항 목록, {의도: [조항 ID]})를 돌려준다."""
    lines = text.splitlines()

    # 1) 의도 -> 조항 매핑 표
    intents = {}
    in_table = False
    for line in lines:
        if line.startswith("## 의도 → 조항 매핑"):
            in_table = True
            continue
        if in_table:
            if line.strip() == "---":
                break
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            if len(cells) == 2 and cells[0] not in ("의도", "---") and not set(cells[0]) <= {"-", " "}:
                intents[cells[0]] = _expand_ids(cells[1])

    # 2) 조항
    clauses, current = [], None

    def finish():
        if current is None:
            return
        body = [ln for ln in current["body"]]
        cautions = tuple(ln[len(CAUTION_PREFIX):].strip() for ln in body if ln.startswith(CAUTION_PREFIX))
        content = "\n".join(ln for ln in body if not ln.startswith(CAUTION_PREFIX)).strip()
        if not content:
            raise PolicyError(f"조항 {current['id']}에 내용이 없습니다.")
        clauses.append(Clause(current["id"], current["title"], current["label"], content, cautions))

    for number, line in enumerate(lines, start=1):
        header = _HEADER.match(line)
        if header:
            finish()
            current = {"id": header["id"], "title": header["title"], "label": header["label"], "body": []}
        elif line.startswith("### ["):
            # 조항 제목처럼 보이는데 형식이 틀린 줄을 본문으로 잘못 읽지 않도록 바로 알린다.
            raise PolicyError(f"{number}번째 줄: 조항 제목 형식이 틀렸습니다 (### [ID] 제목 [라벨]): {line}")
        elif line.startswith("## ") or line.strip() == "---":
            finish()
            current = None
        elif current is not None:
            current["body"].append(line.rstrip())
    finish()

    ids = [c.id for c in clauses]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        raise PolicyError(f"조항 ID가 중복됩니다: {sorted(dup)}")
    missing = {i for ids_ in intents.values() for i in ids_} - set(ids)
    if missing:
        raise PolicyError(f"매핑표가 가리키지만 조항이 없는 ID: {sorted(missing)}")
    return clauses, intents


class PolicyBook:
    """정책 조항 모음. 조항 찾기와 번호 확인을 맡는다."""

    def __init__(self, text=None, path=POLICY_PATH):
        if text is None:
            text = Path(path).read_text(encoding="utf-8")
        self.clauses, self._intents = parse_policy(text)
        self._by_id = {c.id: c for c in self.clauses}
        missing_intents = [i for i in LABEL_TO_INTENT.values() if i not in self._intents]
        if missing_intents:
            raise PolicyError(f"매핑표에 없는 의도: {missing_intents}")

        self._vectorizer = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 3), sublinear_tf=True)
        self._matrix = self._vectorizer.fit_transform([c.search_text for c in self.clauses])
        self._index = {c.id: n for n, c in enumerate(self.clauses)}

    def __len__(self):
        return len(self.clauses)

    def get(self, clause_id):
        return self._by_id.get(clause_id)

    def exists(self, clause_id):
        return clause_id in self._by_id

    def candidates(self, label):
        """분류된 문의 종류에 연결된 조항들."""
        intent = LABEL_TO_INTENT.get(label)
        return [self._by_id[i] for i in self._intents.get(intent, [])]

    def scores(self, label, text):
        """후보 조항마다 문의와의 내용 유사도 (높은 순).

        label이 None이면 분류를 믿을 수 없는 문의이므로 정책 전체를 후보로 삼는다.
        """
        candidates = self.clauses if label is None else self.candidates(label)
        if not candidates or not text.strip():
            return []
        query = self._vectorizer.transform([text])
        rows = [self._index[c.id] for c in candidates]
        sims = cosine_similarity(query, self._matrix[rows])[0]
        return sorted(zip(candidates, (float(s) for s in sims)), key=lambda p: -p[1])

    def find_evidence(self, label, text, limit=MAX_EVIDENCE, min_score=None):
        """근거로 인정할 조항을 (조항, 유사도) 목록으로 돌려준다. 없으면 빈 목록."""
        threshold = MIN_SIMILARITY if min_score is None else min_score
        return [(c, s) for c, s in self.scores(label, text) if s >= threshold][:limit]
