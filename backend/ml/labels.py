"""문의 종류(정답) 7가지의 이름과 한글 표기."""

LABELS = [
    "buyer_delivery",
    "buyer_inspection_result",
    "buyer_cancel_refund",
    "buyer_payment",
    "seller_inspection_fail",
    "seller_penalty",
    "seller_settlement",
]

LABEL_KO = {
    "buyer_delivery": "배송",
    "buyer_inspection_result": "검수 결과",
    "buyer_cancel_refund": "취소·환불",
    "buyer_payment": "결제",
    "seller_inspection_fail": "검수 불합격",
    "seller_penalty": "페널티",
    "seller_settlement": "정산",
}

LABEL_WHO_KO = {label: ("구매자" if label.startswith("buyer_") else "판매자") for label in LABELS}

DIFFICULTIES = ["easy", "medium", "hard"]
