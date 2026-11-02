"""문의 목록 보기, 한 건 보기, 새 문의 등록."""
from fastapi import APIRouter, Depends, HTTPException, Request

from app import inquiries as service
from app.deps import current_agent, get_conn
from app.schemas import InquiryCreate, InquiryOut

router = APIRouter(prefix="/api/inquiries", tags=["inquiries"])


@router.get("", response_model=list[InquiryOut])
def list_inquiries(agent=Depends(current_agent), conn=Depends(get_conn)):
    return service.list_inquiries(conn)


@router.get("/{inquiry_id}", response_model=InquiryOut)
def get_inquiry(inquiry_id: int, agent=Depends(current_agent), conn=Depends(get_conn)):
    inquiry = service.get_inquiry(conn, inquiry_id)
    if inquiry is None:
        raise HTTPException(status_code=404, detail="문의를 찾을 수 없습니다.")
    return inquiry


@router.post("", response_model=InquiryOut, status_code=201)
def create_inquiry(
    payload: InquiryCreate,
    request: Request,
    agent=Depends(current_agent),
    conn=Depends(get_conn),
):
    try:
        inquiry = service.create_inquiry(
            conn, request.app.state.classifier, payload.body, agent_id=agent["id"]
        )
    except service.InvalidInquiry as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    conn.commit()
    return inquiry
