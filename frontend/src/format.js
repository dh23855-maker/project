// 화면에 보여줄 글자 만들기

export const STATUS_LABEL = {
  awaiting_approval: '승인 대기',
  manual: '직접 작성',
  done: '처리 완료',
}

export const ACTION_LABEL = {
  approve: '승인',
  edit: '수정',
  rewrite: '재작성',
  manual_write: '직접 작성',
}

export function formatTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function snippet(text, length = 44) {
  const flat = (text || '').replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length)}…` : flat
}

export function classificationText(inquiry) {
  if (!inquiry.predicted_label_ko) return '분류 결과 없음'
  return `${inquiry.predicted_label_ko} (확신도 ${inquiry.confidence_percent}%)`
}
