"""문의 현황: 날짜별로 어떤 종류의 문의가 얼마나 들어왔는지 센다.

날짜는 한국 시간(Asia/Seoul) 기준이다. 선택한 기간의 모든 날짜를 채워서 (문의가 없는 날은 0건) 돌려준다.
"""
from datetime import timedelta

from ml.labels import LABEL_KO, LABEL_WHO_KO, LABELS

DAY_CHOICES = (7, 14, 30)
DEFAULT_DAYS = 14
TIMEZONE = "Asia/Seoul"
UNCLASSIFIED = "none"  # 분류 결과가 없는 문의 (분류에 실패한 경우)
UNCLASSIFIED_KO = "분류 없음"
BAD_DAYS_MESSAGE = "기간은 7, 14, 30일 중에서 고르세요."


class StatsError(ValueError):
    """요청이 잘못되었을 때 (메시지는 상담사에게 그대로 보여도 된다)."""


def _percent(count, total):
    return round(count * 100 / total, 1) if total else 0.0


def inquiry_stats(conn, days=DEFAULT_DAYS):
    if days not in DAY_CHOICES:
        raise StatsError(BAD_DAYS_MESSAGE)

    today = conn.execute(f"SELECT (now() AT TIME ZONE '{TIMEZONE}')::date AS today").fetchone()["today"]
    start = today - timedelta(days=days - 1)
    rows = conn.execute(
        f"""
        SELECT (created_at AT TIME ZONE '{TIMEZONE}')::date AS day, predicted_label, count(*) AS n
        FROM inquiries
        WHERE (created_at AT TIME ZONE '{TIMEZONE}')::date BETWEEN %s AND %s
        GROUP BY 1, 2
        """,
        (start, today),
    ).fetchall()

    per_day = {}
    totals = {}
    for row in rows:
        code = row["predicted_label"] or UNCLASSIFIED
        per_day.setdefault(row["day"], {})[code] = row["n"]
        totals[code] = totals.get(code, 0) + row["n"]

    codes = list(LABELS) + ([UNCLASSIFIED] if totals.get(UNCLASSIFIED) else [])
    grand_total = sum(totals.values())

    daily = []
    for offset in range(days):
        day = start + timedelta(days=offset)
        counts = {code: per_day.get(day, {}).get(code, 0) for code in codes}
        daily.append({"date": day.isoformat(), "total": sum(counts.values()), "counts": counts})

    types = [
        {
            "code": code,
            "name": LABEL_KO.get(code, UNCLASSIFIED_KO),
            "who": LABEL_WHO_KO.get(code, ""),
            "count": totals.get(code, 0),
            "percent": _percent(totals.get(code, 0), grand_total),
        }
        for code in codes
    ]
    return {
        "days": days,
        "start": start.isoformat(),
        "end": today.isoformat(),
        "total": grand_total,
        "types": types,
        "daily": daily,
    }
