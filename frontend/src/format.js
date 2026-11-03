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

const two = (n) => String(n).padStart(2, '0')

// 2026.11.03 09:51 AM (브라우저의 시간대 기준)
export function formatTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const hours = date.getHours()
  const clock = `${two(hours % 12 === 0 ? 12 : hours % 12)}:${two(date.getMinutes())} ${hours < 12 ? 'AM' : 'PM'}`
  return `${date.getFullYear()}.${two(date.getMonth() + 1)}.${two(date.getDate())} ${clock}`
}

export function snippet(text, length = 44) {
  const flat = (text || '').replace(/\s+/g, ' ').trim()
  return flat.length > length ? `${flat.slice(0, length)}…` : flat
}

export function classificationText(inquiry) {
  if (!inquiry.predicted_label_ko) return '분류 결과 없음'
  return `${inquiry.predicted_label_ko} (확신도 ${inquiry.confidence_percent}%)`
}
