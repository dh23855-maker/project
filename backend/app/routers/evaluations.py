"""성능 평가: 실행하기, 이전 실행 결과 보기. 로그인한 모든 상담사가 쓸 수 있다."""
from fastapi import APIRouter, Depends, Request

from app import evaluation
from app.deps import current_agent, get_conn
from app.schemas import EvaluationDetail, EvaluationSummary

router = APIRouter(prefix="/api", tags=["evaluations"])


@router.get("/evaluations", response_model=list[EvaluationSummary])
def list_evaluations(agent=Depends(current_agent), conn=Depends(get_conn)):
    return evaluation.list_runs(conn)


@router.get("/evaluations/{run_id}", response_model=EvaluationDetail)
def get_evaluation(run_id: int, agent=Depends(current_agent), conn=Depends(get_conn)):
    return evaluation.get_run(conn, run_id)


@router.post("/evaluations", response_model=EvaluationDetail, status_code=201)
def run_evaluation(request: Request, agent=Depends(current_agent), conn=Depends(get_conn)):
    state = request.app.state
    result = evaluation.run_evaluation(conn, state.classifier, agent["id"], state.eval_path)
    conn.commit()
    return result
