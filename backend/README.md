# backend 사용법

서버(FastAPI), 분류 모델, 시험이 들어 있습니다. 모든 명령은 `backend` 폴더에서 실행합니다.
비밀값(DB 주소, API 키)은 프로젝트 맨 위의 `.env`에 적습니다. (`.env.example` 참고)

## 처음 한 번

```
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m ml.train           # 분류 모델 학습 (모델 파일은 Git에 올리지 않음)
.venv\Scripts\python.exe -m app.migrate        # DB 표 만들기 (여러 번 실행해도 안전)
.venv\Scripts\python.exe -m app.seed           # 상담사 3명, 위험 표현 20개, 가짜 문의 20개 넣기 (여러 번 실행해도 안전)
```

`app.seed`는 모든 문의의 초안을 OpenAI로 만들기 때문에 `.env`에 `OPENAI_API_KEY`와 `OPENAI_MODEL`이 필요합니다.
분류 모델이나 규정 문서를 바꾼 뒤에는 `app.seed --reset`으로 가짜 문의 20개를 지우고 새 모델로 다시 넣어 상태를 새로 잡습니다. (OpenAI를 20번 부르므로 약간의 비용이 듭니다.)
(상담사가 이미 처리한 가짜 문의가 하나라도 있으면 아무것도 지우지 않고 멈춥니다.)

## 서버 실행

```
.venv\Scripts\python.exe -m uvicorn app.main:create_app --factory --reload
```

서버가 켜지면 http://127.0.0.1:8000/docs 에서 API 목록을 볼 수 있습니다.

## 연습용 상담사 계정

| 아이디 | 이름 | 비밀번호 |
|---|---|---|
| kim | 김상담 | practice1234 |
| park | 박상담 | practice1234 |
| lee | 이상담 | practice1234 |

연습용 값입니다. 실제로 쓰는 비밀번호를 여기에 적지 마세요. 비밀번호는 암호화되어 DB에 저장됩니다.

## 시험

```
.venv\Scripts\python.exe -m unittest discover -s tests -t . -v
```

DB 시험은 `test_`로 시작하는 임시 영역에 표를 새로 만들어 돌리고 끝나면 지웁니다. 실제 데이터는 건드리지 않습니다.

## 평가 (분류 모델 성적)

```
.venv\Scripts\python.exe -m ml.evaluate
```

정답이 달린 평가용 문의 140개로 정확도, 종류별 정확도, 헷갈린 부분을 계산해 `ml/results/eval.json`에 저장합니다.
(`ml/results/v1_eval.json`은 개선 전 첫 모델의 기록입니다.)

화면의 "성능 평가" 메뉴에서 [평가 실행]을 누르면 같은 평가를 서버가 돌리고 결과를 DB(`eval_runs`)에 실행마다 저장합니다. 평가용 문의는 문의 목록에 들어가지 않습니다.

## 분류 모델

글자 조각(2~3글자) TF-IDF + 로지스틱 회귀입니다. 학습용 문의만 쓴 교차 검증으로 단어 방식(74%)보다 글자 조각 방식(88%)이 낫다고 보고 골랐습니다. 상세는 `ml/train.py` 머리말을 보세요.

## 폴더

| 폴더 | 내용 |
|---|---|
| `app/` | 서버 (로그인, 문의, 승인 흐름, 설정, 작업 기록) |
| `ml/` | 분류 모델 학습과 평가 |
| `policies/` | 규정 문서 (`policy_clauses.md`, 조항 102개) |
| `data/` | 학습용·평가용 문의 (설명은 `data/README.md`) |
| `tests/` | 시험 |
