import { useRef, useState } from 'react'
import { STATUS_LABEL, formatTime, snippet } from '../format.js'
import { PillMark, useSlidingPill } from './SlidingPill.jsx'

export function StatusBadge({ status }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABEL[status] ?? status}</span>
}

// 상태 탭: 전체 + 처리할 순서대로
export const FILTER_TABS = [
  { value: 'all', label: '전체' },
  { value: 'awaiting_approval', label: STATUS_LABEL.awaiting_approval },
  { value: 'manual', label: STATUS_LABEL.manual },
  { value: 'done', label: STATUS_LABEL.done },
]
export const DEFAULT_FILTER = 'all'
// 승인 대기 탭에 마우스를 올리면 고를 수 있는 "빠른 승인" 보기: 승인 대기 중 빠른 승인 조건을 만족하는 문의만
export const QUICK_FILTER = 'quick'
export const QUICK_LABEL = '빠른 승인'

const time = (item) => new Date(item.created_at).getTime() || 0
// 같은 시각이면 번호가 큰(나중에 들어온) 문의를 새것으로 본다
export const newestFirst = (a, b) => time(b) - time(a) || b.id - a.id

export const SORT_OPTIONS = [
  { value: 'newest', label: '최신순' },
  { value: 'oldest', label: '오래된순' },
]
export const DEFAULT_SORT = 'newest'

const isQuick = (item) => item.status === 'awaiting_approval' && item.quick_approvable

export function filterInquiries(items, filter, sort = DEFAULT_SORT) {
  let list
  if (filter === 'all') list = [...items]
  else if (filter === QUICK_FILTER) list = items.filter(isQuick)
  else list = items.filter((item) => item.status === filter)
  return list.sort(sort === 'oldest' ? (a, b) => -newestFirst(a, b) : newestFirst)
}

export function countByStatus(items) {
  const counts = { all: items.length, [QUICK_FILTER]: items.filter(isQuick).length }
  for (const item of items) counts[item.status] = (counts[item.status] ?? 0) + 1
  return counts
}

// 승인 대기 탭: 마우스를 올리거나 키보드로 오면 "승인 대기 / 빠른 승인" 중에서 고를 수 있다 (처음은 승인 대기).
// 빠른 승인을 고르면 탭 이름이 "빠른 승인"으로 바뀌어 지금 어느 보기인지 알 수 있다.
function AwaitingTab({ filter, counts, onChange }) {
  const [open, setOpen] = useState(false)
  const quick = filter === QUICK_FILTER
  const active = quick || filter === 'awaiting_approval'
  const choose = (value) => {
    onChange(value)
    setOpen(false)
  }
  return (
    // 메뉴까지 포함한 영역에 마우스가 있거나 키보드 초점이 있는 동안 메뉴를 연다
    <div
      className="status-tab-wrap"
      role="presentation"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-haspopup="menu"
        aria-expanded={open}
        className={`status-tab ${active ? 'active' : ''}`}
        onClick={() => {
          if (!active) choose('awaiting_approval') // 이미 이 탭이면 지금 보기(승인 대기 또는 빠른 승인)를 그대로 둔다
        }}
      >
        {quick ? QUICK_LABEL : STATUS_LABEL.awaiting_approval}{' '}
        <span className="status-tab-count">{quick ? counts[QUICK_FILTER] : (counts.awaiting_approval ?? 0)}</span>
      </button>
      {open && (
        <div className="tab-menu" role="menu" aria-label="승인 대기 보기 방식">
          <div className="tab-menu-card">
            <button
              type="button"
              role="menuitemradio"
              aria-checked={!quick}
              className="tab-menu-item"
              onClick={() => choose('awaiting_approval')}
            >
              {STATUS_LABEL.awaiting_approval} <span className="status-tab-count">{counts.awaiting_approval ?? 0}</span>
            </button>
            <button
              type="button"
              role="menuitemradio"
              aria-checked={quick}
              className="tab-menu-item"
              onClick={() => choose(QUICK_FILTER)}
            >
              {QUICK_LABEL} <span className="status-tab-count">{counts[QUICK_FILTER] ?? 0}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// 상태별로 골라 보는 탭. 탭마다 건수를 보여 준다.
export function StatusTabs({ items, filter, onChange }) {
  const counts = countByStatus(items)
  const tabsRef = useRef(null)
  const { box, animate } = useSlidingPill(tabsRef, '.status-tab.active', filter)
  return (
    <div className="status-tabs" role="tablist" aria-label="상태별 보기" ref={tabsRef}>
      <PillMark box={box} animate={animate} className="tab-pill" />
      {FILTER_TABS.map((tab) =>
        tab.value === 'awaiting_approval' ? (
          <AwaitingTab key={tab.value} filter={filter} counts={counts} onChange={onChange} />
        ) : (
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
        ),
      )}
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
