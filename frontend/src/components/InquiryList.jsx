import { STATUS_LABEL, formatTime, snippet } from '../format.js'

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>
}

// 받은편지함: 문의 목록. 상태, 분류 결과, 확신도를 한눈에 볼 수 있다.
export default function InquiryList({ items, selectedId, onSelect, state }) {
  if (state === 'loading') return <p className="muted pad">문의를 불러오는 중...</p>
  if (state === 'error') return <p className="field-error pad">문의 목록을 불러오지 못했습니다.</p>
  if (items.length === 0) return <p className="muted pad">문의가 없습니다.</p>

  return (
    <ul className="inquiry-list" aria-label="문의 목록">
      {items.map((item) => (
        <li key={item.id}>
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
      ))}
    </ul>
  )
}
