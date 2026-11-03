import { Fragment } from 'react'
import { STATUS_LABEL, formatTime, snippet } from '../format.js'

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>
}

export const SORT_OPTIONS = [
  { value: 'status', label: '상태별로 모아보기' },
  { value: 'newest', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
]
export const DEFAULT_SORT = 'status'

// 상태별로 모아볼 때의 순서: 먼저 처리할 것부터
const STATUS_ORDER = ['awaiting_approval', 'manual', 'done']

const time = (item) => new Date(item.created_at).getTime() || 0
// 같은 시각이면 번호가 큰(나중에 들어온) 문의를 새것으로 본다
const newestFirst = (a, b) => time(b) - time(a) || b.id - a.id

export function sortInquiries(items, sort) {
  const list = [...items]
  if (sort === 'oldest') return list.sort((a, b) => -newestFirst(a, b))
  if (sort === 'status') {
    const rank = (item) => {
      const index = STATUS_ORDER.indexOf(item.status)
      return index === -1 ? STATUS_ORDER.length : index
    }
    return list.sort((a, b) => rank(a) - rank(b) || newestFirst(a, b))
  }
  return list.sort(newestFirst)
}

// 받은편지함: 문의 목록. 상태, 분류 결과, 확신도를 한눈에 볼 수 있다.
// sort가 'status'이면 상태별로 묶어 제목과 건수를 보여 준다.
export default function InquiryList({ items, selectedId, onSelect, state, sort = DEFAULT_SORT }) {
  if (state === 'loading') return <p className="muted pad">문의를 불러오는 중...</p>
  if (state === 'error') return <p className="field-error pad">문의 목록을 불러오지 못했습니다.</p>
  if (items.length === 0) return <p className="muted pad">문의가 없습니다.</p>

  const sorted = sortInquiries(items, sort)
  const counts = {}
  for (const item of sorted) counts[item.status] = (counts[item.status] ?? 0) + 1

  return (
    <ul className="inquiry-list" aria-label="문의 목록">
      {sorted.map((item, index) => (
        <Fragment key={item.id}>
          {sort === 'status' && (index === 0 || sorted[index - 1].status !== item.status) && (
            <li className="group-head">
              {STATUS_LABEL[item.status] ?? item.status} <span className="muted">{counts[item.status]}건</span>
            </li>
          )}
          <li>
            <button
              type="button"
              className={`inquiry-item ${item.id === selectedId ? 'selected' : ''}`}
              onClick={() => onSelect(item.id)}
              aria-current={item.id === selectedId ? 'true' : undefined}
            >
              <span className="inquiry-top">
                <StatusBadge status={item.status} />
                <span className="inquiry-time">{formatTime(item.created_at)}</span>
              </span>
              <span className="inquiry-text">{snippet(item.body)}</span>
              <span className="inquiry-meta">
                {item.predicted_label_ko ? `${item.predicted_label_ko} · ${item.confidence_percent}%` : '분류 결과 없음'}
              </span>
            </button>
          </li>
        </Fragment>
      ))}
    </ul>
  )
}
