"""설정 화면: 기준값, 위험 표현 목록. 그리고 저장 전 위험 표현 검사."""
from fastapi import APIRouter, Depends, HTTPException

from app import inquiries, risk, workflow
from app.deps import current_agent, get_conn
from app.schemas import (
    PhraseIn,
    RiskCheckIn,
    RiskCheckOut,
    RiskyPhraseOut,
    SettingsOut,
    ThresholdIn,
)

router = APIRouter(prefix="/api", tags=["settings"])


def _settings(conn):
    return {
        "confidence_threshold": inquiries.get_threshold(conn),
        "min": workflow.THRESHOLD_MIN,
        "max": workflow.THRESHOLD_MAX,
    }


@router.get("/settings", response_model=SettingsOut)
def get_settings(agent=Depends(current_agent), conn=Depends(get_conn)):
    return _settings(conn)


@router.put("/settings/confidence-threshold", response_model=SettingsOut)
def put_threshold(payload: ThresholdIn, agent=Depends(current_agent), conn=Depends(get_conn)):
    workflow.set_threshold(conn, agent["id"], payload.value)
    conn.commit()
    return _settings(conn)


@router.get("/risky-phrases", response_model=list[RiskyPhraseOut])
def list_risky_phrases(agent=Depends(current_agent), conn=Depends(get_conn)):
    return risk.list_phrase_rows(conn)


@router.post("/risky-phrases", response_model=list[RiskyPhraseOut], status_code=201)
def add_risky_phrase(payload: PhraseIn, agent=Depends(current_agent), conn=Depends(get_conn)):
    try:
        risk.add_phrase(conn, payload.phrase, agent["id"])
    except risk.InvalidPhrase as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    conn.commit()
    return risk.list_phrase_rows(conn)


@router.post("/risk-check", response_model=RiskCheckOut)
def risk_check(payload: RiskCheckIn, agent=Depends(current_agent), conn=Depends(get_conn)):
    """저장하기 전에 쓴 글에 위험 표현이 있는지 본다. 경고만 하고 저장은 막지 않는다."""
    return {"warnings": risk.find_risks(payload.text or "", risk.list_phrases(conn))}
