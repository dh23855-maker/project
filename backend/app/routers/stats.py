"""문의 현황 보기."""
from fastapi import APIRouter, Depends, HTTPException, Query

from app import stats
from app.deps import current_agent, get_conn
from app.schemas import InquiryStatsOut

router = APIRouter(prefix="/api", tags=["stats"])


@router.get("/stats/inquiries", response_model=InquiryStatsOut)
def inquiry_stats(
    days: int = Query(stats.DEFAULT_DAYS, description="1이면 오늘(시간대별), 7·14·30이면 최근 며칠"),
    agent=Depends(current_agent),
    conn=Depends(get_conn),
):
    try:
        return stats.inquiry_stats(conn, days)
    except stats.StatsError as e:
        raise HTTPException(status_code=400, detail=str(e))
