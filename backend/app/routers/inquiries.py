"""문의 목록, 한 건 보기, 새 문의 등록, 그리고 승인 흐름의 버튼들."""
from fastapi import APIRouter, Depends, HTTPException, Request

from app import inquiries as service
from app import workflow
from app.deps import current_agent, get_conn
from app.schemas import InquiryCreate, InquiryDetail, InquiryOut, ReplyIn, VersionIn

router = APIRouter(prefix="/api/inquiries", tags=["inquiries"])


@router.get("", response_model=list[InquiryOut])
def list_inquiries(agent=Depends(current_agent), conn=Depends(get_conn)):
    return service.list_inquiries(conn)


@router.get("/{inquiry_id}", response_model=InquiryDetail)
def get_inquiry(
    inquiry_id: int, request: Request, agent=Depends(current_agent), conn=Depends(get_conn)
):
    detail = service.get_detail(conn, request.app.state.policy, inquiry_id)
    if detail is None:
        raise HTTPException(status_code=404, detail="문의를 찾을 수 없습니다.")
    return detail


@router.post("", response_model=InquiryDetail, status_code=201)
def create_inquiry(
    payload: InquiryCreate,
    request: Request,
    agent=Depends(current_agent),
    conn=Depends(get_conn),
):
    state = request.app.state
    try:
        created = service.create_inquiry(
            conn, state.classifier, state.policy, state.drafter, payload.body, agent_id=agent["id"]
        )
    except service.InvalidInquiry as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    detail = service.get_detail(conn, state.policy, created["id"])
    conn.commit()
    return detail


@router.post("/{inquiry_id}/approve", response_model=InquiryDetail)
def approve(
    inquiry_id: int, payload: VersionIn, request: Request,
    agent=Depends(current_agent), conn=Depends(get_conn),
):
    result = workflow.approve(conn, request.app.state.policy, agent, inquiry_id, payload.version)
    conn.commit()
    return result


@router.post("/{inquiry_id}/edit", response_model=InquiryDetail)
def edit(
    inquiry_id: int, payload: ReplyIn, request: Request,
    agent=Depends(current_agent), conn=Depends(get_conn),
):
    result = workflow.edit(
        conn, request.app.state.policy, agent, inquiry_id, payload.version, payload.text
    )
    conn.commit()
    return result


@router.post("/{inquiry_id}/rewrite", response_model=InquiryDetail)
def rewrite(
    inquiry_id: int, payload: VersionIn, request: Request,
    agent=Depends(current_agent), conn=Depends(get_conn),
):
    state = request.app.state
    result = workflow.rewrite(conn, state.policy, state.drafter, agent, inquiry_id, payload.version)
    conn.commit()
    return result


@router.post("/{inquiry_id}/handoff", response_model=InquiryDetail)
def handoff(
    inquiry_id: int, payload: VersionIn, request: Request,
    agent=Depends(current_agent), conn=Depends(get_conn),
):
    result = workflow.handoff(conn, request.app.state.policy, agent, inquiry_id, payload.version)
    conn.commit()
    return result


@router.post("/{inquiry_id}/manual-reply", response_model=InquiryDetail)
def manual_reply(
    inquiry_id: int, payload: ReplyIn, request: Request,
    agent=Depends(current_agent), conn=Depends(get_conn),
):
    result = workflow.manual_reply(
        conn, request.app.state.policy, agent, inquiry_id, payload.version, payload.text
    )
    conn.commit()
    return result
