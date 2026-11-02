# 데이터 폴더 설명

모든 문의는 직접 만든 **가짜 문의**입니다. 실제 고객 데이터와 실제 회사·브랜드 이름은 들어 있지 않습니다.

## 폴더

| 위치 | 내용 | 만든 곳 | 쓰임 |
|---|---|---|---|
| `train/train.csv` | 학습용 문의 300개 | Claude | 분류 모델 학습 |
| `eval/eval.csv` | 평가용 문의 140개 (정답 포함) | Gemini | 모델 시험 (학습에 쓰지 않음) |
| `eval/eval_prompt.md` | 평가용 문의를 만들 때 쓴 프롬프트 | Claude | 기록 |

## 파일 형식

- `train.csv` : `text,label`
- `eval.csv` : `text,label,difficulty` (difficulty는 easy / medium / hard)
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
- 평가용 문의는 모델 학습에 쓰지 않습니다. 5일차에 학습 문장을 보강할 때도 평가 문장을 베끼지 않고, 비슷한 문장을 **새로 만들어** 학습용에 추가합니다.
- 학습용은 종류당 40~50개, 총 300개입니다.
