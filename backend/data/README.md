# 데이터 폴더 설명

모든 문의는 직접 만든 **가짜 문의**입니다. 실제 고객 데이터와 실제 회사·브랜드 이름은 들어 있지 않습니다.

## 폴더

| 위치 | 내용 | 만든 곳 | 쓰임 |
|---|---|---|---|
| `train/train.csv` | 학습용 문의 300개 (처음 만든 것) | Claude | 분류 모델 학습 |
| `train/train_extra.csv` | 학습용 문의 보강분 (구어체, 긴 문장, 돌려 말하는 문의 등) | Claude | 분류 모델 학습 |
| `eval/eval.csv` | 평가용 문의 140개 (정답 포함) | Gemini | 모델 시험 (학습에 쓰지 않음) |
| `eval/retrieval_gold.csv` | 평가용 문의 140개 각각에 "답하려면 필요한 규정 조항"을 붙인 정답 표 | Claude | 규정 문서 찾는 방식 비교 (분류 학습에는 쓰지 않음) |
| `eval/eval_prompt.md` | 평가용 문의를 만들 때 쓴 프롬프트 | Claude | 기록 |

## 파일 형식

- `train.csv`, `train_extra.csv` : `text,label` (학습할 때는 두 파일을 합쳐서 씁니다)
- `eval.csv` : `text,label,difficulty` (difficulty는 easy / medium / hard)
- `retrieval_gold.csv` : `eval_row,text,label,difficulty,gold,coverage`. `gold`는 정답 조항 번호를 공백으로 구분(맞는 것이 하나라도 상위에 나오면 성공), `coverage`는 full(규정 문서가 충분히 답함 90개) / partial(일부만 답함 44개) / none(관련 규정 없음 6개, gold 비어 있음)
- 인코딩은 UTF-8입니다.

## 정답(label) 7가지

| label | 한글 이름 | 문의한 사람 |
|---|---|---|
| buyer_delivery | 배송 | 구매자 |
| buyer_inspection_result | 검수 결과 | 구매자 |
| buyer_cancel_refund | 취소·환불 | 구매자 |
| buyer_payment | 결제 | 구매자 |
| seller_inspection_fail | 검수 불합격 | 판매자 |
| seller_penalty | 페널티 | 판매자 |
| seller_settlement | 정산 | 판매자 |

## 지키는 규칙

- 학습용 문의와 평가용 문의는 **절대 섞지 않습니다.** 같은 문장이 양쪽에 있으면 안 됩니다.
- 평가용 문의는 모델 학습에 쓰지 않습니다. 학습 문장을 보강할 때도 평가 문장을 베끼지 않고, 새로 만들어 `train_extra.csv`에 넣습니다. 평가 문장과 글자 유사도가 0.55 이상인 보강 문장은 뺐고, 시험(`tests/test_ml.py`)이 이를 계속 확인합니다.
- 처음 만든 학습용은 종류당 40~50개, 총 300개입니다. 보강분은 종류마다 30개 이상입니다.
- **알아둘 점:** 보강 문장을 쓰기 전에 작성자(Claude)가 평가용 문의를 읽었습니다. 보강 후 평가 점수는 실제 성능보다 낙관적일 수 있습니다. 모델 방식은 평가용 문의 없이 학습용 문의의 교차 검증으로 골랐습니다.
