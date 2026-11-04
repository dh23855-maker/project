import { useRef } from 'react'
import { STATUS_LABEL, formatTime, snippet } from '../format.js'
import { PillMark, useSlidingPill } from './SlidingPill.jsx'

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>
}

// 빠른 승인 탭: 승인 대기 중 빠른 승인 조건을 만족하는 문의만 (일괄 승인의 대상)
export const QUICK_FILTER = 'quick'
export const QUICK_LABEL = '빠른 승인'

// 상태 탭: 전체 / 승인 대기 / 빠른 승인 / 처리 완료
export const FILTER_TABS = [
  { value: 'all', label: '전체' },
  { value: 'awaiting_approval', label: STATUS_LABEL.awaiting_approval },
  { value: QUICK_FILTER, label: QUICK_LABEL },
  { value: 'done', label: STATUS_LABEL.done },
]
export const DEFAULT_FILTER = 'all'

const time = (item) => new Date(item.created_at).getTime() || 0
// 같은 시각이면 번호가 큰(나중에 들어온) 문의를 새것으로 본다
export const newestFirst = (a, b) => time(b) - time(a) || b.id - a.id

export const SORT_OPTIONS = [
  { value: 'newest', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
]
export const DEFAULT_SORT = 'newest'

const isQuick = (item) => item.status === 'awaiting_approval' && item.quick_approvable
// 승인 대기 탭에는 직접 작성 상태(초안을 못 만들었거나 직접 작성으로 넘긴 문의)도 함께 보인다: 상담사가 처리할 일을 한 탭에 모은다
const isPending = (item) => item.status === 'awaiting_approval' || item.status === 'manual'

export function filterInquiries(items, filter, sort = DEFAULT_SORT) {
  let list
  if (filter === 'all') list = [...items]
  else if (filter === QUICK_FILTER) list = items.filter(isQuick)
  else if (filter === 'awaiting_approval') list = items.filter(isPending)
  else list = items.filter((item) => item.status === filter)
  return list.sort(sort === 'oldest' ? (a, b) => -newestFirst(a, b) : newestFirst)
}

export function countByStatus(items) {
  const counts = { all: items.length, [QUICK_FILTER]: items.filter(isQuick).length }
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1
  counts.awaiting_approval = items.filter(isPending).length
  return counts
}

// 상태별로 골라 보는 탭. 탭마다 건수를 보여 준다.
export function StatusTabs({ items, filter, onChange }) {
  const counts = countByStatus(items)
  const tabsRef = useRef(null)
  const { box, animate } = useSlidingPill(tabsRef, '.status-tab.active', filter)
  return (
    <div className="status-tabs" role="tablist" aria-label="상태별 보기" ref={tabsRef}>
      <PillMark box={box} animate={animate} className="tab-pill" />
      {FILTER_TABS.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={filter === tab.value}
          className={`status-tab ${filter === tab.value ? 'active' : ''}`}
          onClick={() => onChange(tab.value)}
        >
          {tab.label} <span className="status-tab-count">{counts[tab.value] ?? 0}</span>
        </button>
      ))}
    </div>
  )
}

// 받은 문의: 문의 목록(상태 탭으로 거르고 최신순 또는 오래된순). 상태, 분류 결과, 확신도를 한눈에 볼 수 있다.
export default function InquiryList({ items, selectedId, onSelect, state, filter = DEFAULT_FILTER, sort = DEFAULT_SORT }) {
  if (state === 'loading') return <p className="muted pad">문의를 불러오는 중...</p>
  if (state === 'error') return <p className="field-error pad">문의 목록을 불러오지 못했습니다.</p>
  if (items.length === 0) return <p className="muted pad">문의가 없습니다.</p>

  const shown = filterInquiries(items, filter, sort)
  if (shown.length === 0) {
    return <p className="muted pad">{filter === QUICK_FILTER ? '빠른 승인할 수 있는 문의가 없습니다.' : '이 상태의 문의가 없습니다.'}</p>
  }

  return (
    <ul className="inquiry-list" aria-label="문의 목록">
      {shown.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            className={`inquiry-item ${item.id === selectedId ? 'selected' : ''}`}
            onClick={() => onSelect(item.id)}
            aria-current={item.id === selectedId ? 'true' : undefined}
          >
            <span className="inquiry-top">
              <span className="inquiry-badges">
                <StatusBadge status={item.status} />
                {isQuick(item) && <span className="badge badge-quick">{QUICK_LABEL}</span>}
              </span>
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
