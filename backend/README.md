# backend 사용법

서버(FastAPI), 분류 모델, 시험이 들어 있습니다. 모든 명령은 `backend` 폴더에서 실행합니다.
비밀값(DB 주소, API 키)은 프로젝트 맨 위의 `.env`에 적습니다. (`.env.example` 참고)

## 처음 한 번

```
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r requirements.txt
.venv\Scripts\python.exe -m ml.train_v1        # 분류 모델 학습 (모델 파일은 Git에 올리지 않음)
.venv\Scripts\python.exe -m app.migrate        # DB 표 만들기 (여러 번 실행해도 안전)
.venv\Scripts\python.exe -m app.seed           # 상담사 3명과 가짜 문의 20개 넣기 (여러 번 실행해도 안전)
```

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
.venv\Scripts\python.exe -m ml.evaluate --version v1
```

## 폴더

| 폴더 | 내용 |
|---|---|
| `app/` | 서버 (로그인, 문의) |
| `ml/` | 분류 모델 학습과 평가 |
| `data/` | 학습용·평가용 문의 (설명은 `data/README.md`) |
| `tests/` | 시험 |
