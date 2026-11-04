"""문의 현황: 어떤 종류의 문의가 언제 얼마나 들어왔고, 초안과 처리가 어땠는지 센다.

- 날짜와 시각은 한국 시간(Asia/Seoul) 기준이다.
- 기간이 "오늘"(1일)이면 시간대별(0시~23시), 그 밖에는 날짜별로 센다. 문의가 없는 칸도 0으로 채워서 돌려준다.
- 기간은 오늘·7·14·30일 중에서 고르거나, 시작일과 종료일을 직접 지정한다(최대 90일, 오늘 이후는 안 됨).
  직접 지정한 기간이 하루뿐이면 그날을 시간대별로 센다.
- 선택한 기간 안에 **들어온 문의**(created_at이 기간 안)만 센다. 처리 현황도 이 문의들의 지금 상태다.
"""
import statistics
from datetime import date, timedelta

from app.inquiries import DEFAULT_THRESHOLD
from ml.labels import LABEL_KO, LABEL_WHO_KO, LABELS

DAY_CHOICES = (1, 7, 14, 30)  # 1 = 오늘 (시간대별)
DEFAULT_DAYS = 14
MAX_CUSTOM_DAYS = 90  # 직접 지정할 수 있는 가장 긴 기간
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


def _custom_range(start_text, end_text, today):
    """직접 지정한 시작일·종료일(YYYY-MM-DD)을 확인해 (시작일, 종료일)로 돌려준다. 잘못되면 StatsError."""
    if not start_text or not end_text:
        raise StatsError("시작일과 종료일을 함께 지정하세요.")
    try:
        start, end = date.fromisoformat(start_text), date.fromisoformat(end_text)
    except ValueError:
        raise StatsError("날짜는 2026-11-03처럼 연-월-일 형식으로 보내세요.") from None
    if start > end:
        raise StatsError("시작일이 종료일보다 늦을 수 없습니다.")
    if end > today:
        raise StatsError("오늘 이후의 날짜는 고를 수 없습니다.")
    if (end - start).days + 1 > MAX_CUSTOM_DAYS:
        raise StatsError(f"직접 지정은 최대 {MAX_CUSTOM_DAYS}일까지 고를 수 있습니다.")
    return start, end


def inquiry_stats(conn, days=DEFAULT_DAYS, start_text=None, end_text=None):
    """days(오늘·7·14·30일) 또는 직접 지정한 시작일~종료일의 문의 현황.

    start_text, end_text를 주면 days는 무시한다. 하루만 지정하면 그날을 시간대별로 보여 준다(오늘과 같은 모양).
    """
    custom = start_text is not None or end_text is not None
    if not custom and days not in DAY_CHOICES:
        raise StatsError(BAD_DAYS_MESSAGE)

    clock = conn.execute(
        f"SELECT (now() AT TIME ZONE '{TIMEZONE}')::date AS today, EXTRACT(HOUR FROM (now() AT TIME ZONE '{TIMEZONE}'))::int AS hour"
    ).fetchone()
    today = clock["today"]
    if custom:
        start, end = _custom_range(start_text, end_text, today)
        days = (end - start).days + 1
    else:
        start, end = today - timedelta(days=days - 1), today
    threshold = _threshold(conn)
    rows = conn.execute(
        f"""
        SELECT i.id,
               (i.created_at AT TIME ZONE '{TIMEZONE}')::date AS day,
               EXTRACT(HOUR FROM (i.created_at AT TIME ZONE '{TIMEZONE}'))::int AS hour,
               i.predicted_label, i.confidence, i.status, i.rewrite_count,
               EXTRACT(EPOCH FROM (i.resolved_at - i.created_at)) / 60.0 AS minutes_to_resolve,
               d.cited_count, (d.inquiry_id IS NOT NULL) AS has_draft,
               a.action AS last_action
        FROM inquiries i
        LEFT JOIN LATERAL (
            SELECT inquiry_id, jsonb_array_length(cited_articles) AS cited_count FROM drafts
            WHERE inquiry_id = i.id ORDER BY draft_no DESC LIMIT 1
        ) d ON true
        LEFT JOIN LATERAL (
            SELECT action FROM action_logs
            WHERE inquiry_id = i.id AND action = ANY(%s) ORDER BY id DESC LIMIT 1
        ) a ON true
        WHERE (i.created_at AT TIME ZONE '{TIMEZONE}')::date BETWEEN %s AND %s
        """,
        (list(RESOLVING_ACTIONS), start, end),
    ).fetchall()

    for r in rows:
        r["code"] = r["predicted_label"] or UNCLASSIFIED
        # 지금 초안이 규정 문서를 하나도 참고하지 못했는가 = "규정 문서에는 없음" (초안이 있는 문의만 말할 수 있다)
        r["uncovered"] = bool(r["has_draft"] and r["cited_count"] == 0)
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

    # 지금까지 지난 칸 수: 오늘 하루만 보면 0시부터 지금 시각까지의 시간 수, 지난 하루는 24시간, 여러 날이면 날수
    elapsed = days if days > 1 else (clock["hour"] + 1 if end == today else 24)
    return {
        "days": days,
        "unit": unit,
        "elapsed": elapsed,
        "today": today.isoformat(),
        "start": start.isoformat(),
        "end": end.isoformat(),
        "total": len(rows),
        "threshold": threshold,
        "overall": summarize(rows),
        "types": types,
        "buckets": buckets,
        "handling": handling,
    }
