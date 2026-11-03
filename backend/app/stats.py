"""문의 현황: 어떤 종류의 문의가 언제 얼마나 들어왔고, 초안과 처리가 어땠는지 센다.

- 날짜와 시각은 한국 시간(Asia/Seoul) 기준이다.
- 기간이 "오늘"(1일)이면 시간대별(0시~23시), 그 밖에는 날짜별로 센다. 문의가 없는 칸도 0으로 채워서 돌려준다.
- 선택한 기간 안에 **들어온 문의**(created_at이 기간 안)만 센다. 처리 현황도 이 문의들의 지금 상태다.
"""
import statistics
from datetime import timedelta

from app.inquiries import DEFAULT_THRESHOLD
from ml.labels import LABEL_KO, LABEL_WHO_KO, LABELS

DAY_CHOICES = (1, 7, 14, 30)  # 1 = 오늘 (시간대별)
DEFAULT_DAYS = 14
TIMEZONE = "Asia/Seoul"
UNCLASSIFIED = "none"  # 분류 결과가 없는 문의 (분류에 실패한 경우)
UNCLASSIFIED_KO = "분류 없음"
BAD_DAYS_MESSAGE = "기간은 오늘, 7, 14, 30일 중에서 고르세요."
RESOLVING_ACTIONS = ("approve", "edit", "manual_write")  # 문의를 처리 완료로 만드는 행동 (재작성은 아님)
STATUSES = ("awaiting_approval", "manual", "done")


class StatsError(ValueError):
    """요청이 잘못되었을 때 (메시지는 상담사에게 그대로 보여도 된다)."""


def _percent(part, whole):
    """whole이 0이면 None (비율을 말할 수 없다)."""
    return round(part * 100 / whole, 1) if whole else None


def _minutes_text(minutes):
    return None if minutes is None else round(minutes, 1)


def _empty_counts(codes):
    return {code: 0 for code in codes}


def _threshold(conn):
    row = conn.execute("SELECT value FROM settings WHERE key = 'confidence_threshold'").fetchone()
    return int(row["value"]) if row else DEFAULT_THRESHOLD


def inquiry_stats(conn, days=DEFAULT_DAYS):
    if days not in DAY_CHOICES:
        raise StatsError(BAD_DAYS_MESSAGE)

    clock = conn.execute(
        f"SELECT (now() AT TIME ZONE '{TIMEZONE}')::date AS today, EXTRACT(HOUR FROM (now() AT TIME ZONE '{TIMEZONE}'))::int AS hour"
    ).fetchone()
    today = clock["today"]
    start = today - timedelta(days=days - 1)
    threshold = _threshold(conn)
    rows = conn.execute(
        f"""
        SELECT i.id,
               (i.created_at AT TIME ZONE '{TIMEZONE}')::date AS day,
               EXTRACT(HOUR FROM (i.created_at AT TIME ZONE '{TIMEZONE}'))::int AS hour,
               i.predicted_label, i.confidence, i.status, i.rewrite_count,
               EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) / 60.0 AS minutes_to_resolve,
               d.uncovered_note, (d.inquiry_id IS NOT NULL) AS has_draft,
               a.action AS last_action
        FROM inquiries i
        LEFT JOIN LATERAL (
            SELECT inquiry_id, uncovered_note FROM drafts
            WHERE inquiry_id = i.id ORDER BY draft_no DESC LIMIT 1
        ) d ON true
        LEFT JOIN LATERAL (
            SELECT action FROM action_logs
            WHERE inquiry_id = i.id AND action = ANY(%s) ORDER BY id DESC LIMIT 1
        ) a ON true
        WHERE (i.created_at AT TIME ZONE '{TIMEZONE}')::date BETWEEN %s AND %s
        """,
        (list(RESOLVING_ACTIONS), start, today),
    ).fetchall()

    for r in rows:
        r["code"] = r["predicted_label"] or UNCLASSIFIED
        # 지금 초안이 규정 문서에 없는 내용을 알리고 있는가 (초안이 있는 문의만 말할 수 있다)
        r["uncovered"] = bool(r["has_draft"] and (r["uncovered_note"] or "").strip())
        # 확신도가 기준값보다 낮거나 분류를 못 한 문의
        r["low"] = r["confidence"] is None or round(r["confidence"] * 100, 6) < threshold

    totals = {}
    for r in rows:
        totals[r["code"]] = totals.get(r["code"], 0) + 1
    codes = list(LABELS) + ([UNCLASSIFIED] if totals.get(UNCLASSIFIED) else [])

    def summarize(group):
        """한 묶음(칸 하나, 종류 하나, 전체)의 건수와 비율."""
        drafted = sum(1 for r in group if r["has_draft"])
        uncovered = sum(1 for r in group if r["uncovered"])
        low = sum(1 for r in group if r["low"])
        return {
            "total": len(group),
            "drafted": drafted,
            "uncovered": uncovered,
            "uncovered_percent": _percent(uncovered, drafted),
            "low_confidence": low,
            "low_confidence_percent": _percent(low, len(group)),
        }

    # --- 칸(날짜 또는 시간대)별 ---
    if days == 1:
        unit = "hour"
        slots = [(f"{h:02d}", f"{h}시", lambda r, h=h: r["hour"] == h) for h in range(24)]
    else:
        unit = "day"
        slots = []
        for offset in range(days):
            day = start + timedelta(days=offset)
            slots.append((day.isoformat(), day.isoformat(), lambda r, day=day: r["day"] == day))
    buckets = []
    for key, label, belongs in slots:
        group = [r for r in rows if belongs(r)]
        counts = _empty_counts(codes)
        for r in group:
            counts[r["code"]] += 1
        buckets.append({"key": key, "label": label, "counts": counts, **summarize(group)})

    # --- 종류별 ---
    types = []
    for code in codes:
        group = [r for r in rows if r["code"] == code]
        types.append(
            {
                "code": code,
                "name": LABEL_KO.get(code, UNCLASSIFIED_KO),
                "who": LABEL_WHO_KO.get(code, ""),
                "count": len(group),
                "percent": _percent(len(group), len(rows)) or 0.0,
                **{k: v for k, v in summarize(group).items() if k != "total"},
            }
        )

    # --- 처리 현황 ---
    statuses = {s: sum(1 for r in rows if r["status"] == s) for s in STATUSES}
    done = [r for r in rows if r["status"] == "done"]
    resolution = {a: sum(1 for r in done if r["last_action"] == a) for a in RESOLVING_ACTIONS}
    minutes = [r["minutes_to_resolve"] for r in done if r["minutes_to_resolve"] is not None]
    handling = {
        "statuses": statuses,
        "done": len(done),
        "resolution": resolution,
        "approve_percent": _percent(resolution["approve"], len(done)),
        "rewrite_count": sum(1 for r in rows if r["rewrite_count"] > 0),
        "rewrite_percent": _percent(sum(1 for r in rows if r["rewrite_count"] > 0), len(rows)),
        "median_minutes": _minutes_text(statistics.median(minutes)) if minutes else None,
        "average_minutes": _minutes_text(statistics.fmean(minutes)) if minutes else None,
    }

    return {
        "days": days,
        "unit": unit,
        "elapsed": clock["hour"] + 1 if days == 1 else days,  # 지금까지 지난 칸 수 (오늘이면 0시부터 지금 시각까지의 시간 수)
        "start": start.isoformat(),
        "end": today.isoformat(),
        "total": len(rows),
        "threshold": threshold,
        "overall": summarize(rows),
        "types": types,
        "buckets": buckets,
        "handling": handling,
    }
