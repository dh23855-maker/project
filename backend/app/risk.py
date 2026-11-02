"""위험 표현 검사: 상담사가 약속하면 안 되는 말이 글에 들어 있는지 찾는다.

띄어쓰기는 무시하고 비교한다 ('보상해 드'는 '보상해드릴게요'도 잡는다).
경고만 하고 저장은 막지 않는다.
"""
import re

_SPLIT = re.compile(r"(?<=[.!?。])\s+|\n+")


def normalize(text):
    return re.sub(r"\s+", "", text or "")


def split_sentences(text):
    return [s.strip() for s in _SPLIT.split(text or "") if s.strip()]


def find_risks(text, phrases):
    """문장별로 걸린 위험 표현을 [{'sentence', 'phrases'}] 로 돌려준다. 없으면 빈 목록."""
    wanted = [(p, normalize(p)) for p in phrases if normalize(p)]
    found = []
    for sentence in split_sentences(text):
        flat = normalize(sentence)
        hit = [p for p, n in wanted if n in flat]
        if hit:
            found.append({"sentence": sentence, "phrases": hit})
    return found


def list_phrases(conn):
    rows = conn.execute("SELECT phrase FROM risky_phrases ORDER BY id").fetchall()
    return [r["phrase"] for r in rows]


def list_phrase_rows(conn):
    return conn.execute(
        "SELECT p.id, p.phrase, p.created_at, a.display_name AS created_by_name"
        " FROM risky_phrases p LEFT JOIN agents a ON a.id = p.created_by ORDER BY p.id"
    ).fetchall()


class InvalidPhrase(ValueError):
    pass


def add_phrase(conn, raw, agent_id):
    phrase = (raw or "").strip()
    if not phrase:
        raise InvalidPhrase("위험 표현을 입력하세요.")
    row = conn.execute(
        "INSERT INTO risky_phrases (phrase, created_by) VALUES (%s, %s)"
        " ON CONFLICT DO NOTHING RETURNING id",
        (phrase, agent_id),
    ).fetchone()
    if row is None:
        raise InvalidPhrase("이미 목록에 있는 표현입니다.")
    return row["id"]
