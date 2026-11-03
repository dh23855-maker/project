"""성능 평가: 정답이 달린 연습용 문의 묶음을 지금 쓰는 분류 모델로 한 번에 돌리고, 결과를 저장한다.

- 평가용 문의는 DB의 문의 목록(inquiries)에 넣지 않는다. 파일에서 읽어 계산만 한다.
- 실행 도중 오류가 나면 아무것도 저장하지 않는다 (반쪽 결과 없음).
- 계산은 ml.evaluate의 함수를 그대로 쓰므로, 명령줄 평가(python -m ml.evaluate)와 결과가 같다.
"""
import logging
from datetime import datetime

from psycopg.types.json import Jsonb

from app.workflow import WorkflowError
from ml.data import EVAL_PATH, find_duplicates, find_overlap, load_dataset, load_training_rows
from ml.evaluate import compute_metrics, predict
from ml.labels import DIFFICULTIES, LABEL_KO, LABELS

logger = logging.getLogger(__name__)

NOT_READY_MESSAGE = "평가용 연습 문의 묶음이 준비되어 있지 않아 평가를 실행할 수 없습니다."
RUN_FAIL_MESSAGE = "평가를 끝까지 실행하지 못했습니다. 결과는 저장하지 않았습니다. 잠시 후 다시 시도해 주세요."
NOT_FOUND_MESSAGE = "평가 결과를 찾을 수 없습니다."


def label_names():
    return [{"key": label, "ko": LABEL_KO[label]} for label in LABELS]


def run_evaluation(conn, classifier, agent_id, eval_path=EVAL_PATH):
    """평가를 한 번 실행해 결과를 저장하고, 저장한 결과(상세)를 돌려준다."""
    if not eval_path.exists():
        raise WorkflowError(409, NOT_READY_MESSAGE)
    try:
        rows = load_dataset(eval_path, with_difficulty=True)
    except (ValueError, OSError) as e:
        logger.warning("평가용 파일을 읽지 못했습니다: %s", e)
        raise WorkflowError(409, NOT_READY_MESSAGE) from e
    if not rows:
        raise WorkflowError(409, NOT_READY_MESSAGE)

    try:
        train_rows = load_training_rows()
        if find_duplicates(rows) or find_overlap(train_rows, rows):
            raise ValueError("평가용 문의에 중복 문장이 있거나 학습용과 겹칩니다.")
        predictions, confidences = predict(classifier.bundle, rows)
        result = compute_metrics(rows, predictions, confidences)
        result.update(
            description=classifier.description,
            evaluated_at=datetime.now().isoformat(timespec="seconds"),
            train_size=len(train_rows),
            eval_file=eval_path.name,
        )
        row = conn.execute(
            "INSERT INTO eval_runs (run_by, result) VALUES (%s, %s) RETURNING id", (agent_id, Jsonb(result))
        ).fetchone()
    except Exception as e:
        conn.rollback()
        logger.exception("평가 실행이 실패했습니다")
        raise WorkflowError(500, RUN_FAIL_MESSAGE) from e
    return get_run(conn, row["id"])


def _summary(row):
    result = row["result"]
    return {
        "id": row["id"],
        "created_at": row["created_at"],
        "run_by_name": row["run_by_name"],
        "total": result["total"],
        "correct": result["correct"],
        "accuracy": result["accuracy"],
        "description": result.get("description"),
    }


_SELECT = (
    "SELECT e.id, e.created_at, e.result, a.display_name AS run_by_name"
    " FROM eval_runs e LEFT JOIN agents a ON a.id = e.run_by"
)


def list_runs(conn, limit=50):
    rows = conn.execute(_SELECT + " ORDER BY e.created_at DESC, e.id DESC LIMIT %s", (limit,)).fetchall()
    return [_summary(r) for r in rows]


def get_run(conn, run_id):
    row = conn.execute(_SELECT + " WHERE e.id = %s", (run_id,)).fetchone()
    if row is None:
        raise WorkflowError(404, NOT_FOUND_MESSAGE)
    detail = _summary(row)
    result = row["result"]
    detail.update(
        per_label=result["per_label"],
        per_difficulty=result.get("per_difficulty"),
        confusions=result["confusions"],
        wrong=result["wrong"],
        train_size=result.get("train_size"),
        eval_file=result.get("eval_file"),
        labels=label_names(),
        difficulties=DIFFICULTIES if result.get("per_difficulty") else [],
    )
    return detail
