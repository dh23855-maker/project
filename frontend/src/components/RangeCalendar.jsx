import { useEffect, useRef, useState } from 'react'

export const MAX_CUSTOM_DAYS = 90 // 서버와 같은 제한: 직접 지정은 최대 90일

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
const pad = (n) => String(n).padStart(2, '0')
const toIso = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}` // month: 0~11
const parse = (iso) => ({ year: Number(iso.slice(0, 4)), month: Number(iso.slice(5, 7)) - 1, day: Number(iso.slice(8, 10)) })
const dayNumber = (iso) => {
  const { year, month, day } = parse(iso)
  return Math.round(Date.UTC(year, month, day) / 86400000)
}
const spanDays = (a, b) => Math.abs(dayNumber(a) - dayNumber(b)) + 1

export function localToday() {
  const now = new Date()
  return toIso(now.getFullYear(), now.getMonth(), now.getDate())
}

// 탭에 보여 줄 기간 이름: 같은 날이면 날짜 하나. 시작일이나 종료일이 올해가 아니면 양쪽 모두 연도(2자리)를 앞에 붙인다
export function rangeLabel(start, end, today) {
  const withYear = start.slice(0, 4) !== today.slice(0, 4) || end.slice(0, 4) !== today.slice(0, 4)
  const short = (iso) => `${withYear ? `${iso.slice(2, 4)}.` : ''}${iso.slice(5, 7)}.${iso.slice(8, 10)}`
  return start === end ? short(start) : `${short(start)} ~ ${short(end)}`
}

// 한 달짜리 작은 캘린더. 시작일을 누르고 종료일을 누르면 onPick(시작일, 종료일)을 부른다.
// 같은 날을 두 번 누르면 그날 하루만 고른 것이다. 오늘 이후와 90일을 넘는 날은 누를 수 없다.
function Calendar({ today, selected, onPick }) {
  const anchor = parse(selected?.end ?? today)
  const [view, setView] = useState({ year: anchor.year, month: anchor.month })
  const [first, setFirst] = useState(null) // 처음 누른 날 (종료일을 기다리는 중)
  const [hover, setHover] = useState(null)

  const now = parse(today)
  const atLastMonth = view.year > now.year || (view.year === now.year && view.month >= now.month)
  const move = (delta) => {
    const index = view.year * 12 + view.month + delta
    setView({ year: Math.floor(index / 12), month: index % 12 })
  }

  const lead = new Date(view.year, view.month, 1).getDay()
  const count = new Date(view.year, view.month + 1, 0).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => toIso(view.year, view.month, i + 1))]

  // 지금 칠해 보여 줄 기간: 고르는 중이면 첫 날(과 마우스가 있는 날), 아니면 지난번에 고른 기간
  const shown = first
    ? { start: first, end: hover && hover !== first ? hover : first }
    : selected
  const [from, to] = shown && dayNumber(shown.start) > dayNumber(shown.end) ? [shown.end, shown.start] : [shown?.start, shown?.end]

  function choose(day) {
    if (first == null) {
      setFirst(day)
      return
    }
    const [start, end] = dayNumber(first) <= dayNumber(day) ? [first, day] : [day, first]
    onPick(start, end)
  }

  return (
    <div className="calendar">
      <div className="calendar-head">
        <button type="button" className="calendar-nav" onClick={() => move(-1)} aria-label="이전 달">
          ‹
        </button>
        <strong aria-live="polite">
          {view.year}년 {view.month + 1}월
        </strong>
        <button type="button" className="calendar-nav" onClick={() => move(1)} disabled={atLastMonth} aria-label="다음 달">
          ›
        </button>
      </div>
      <div className="calendar-grid" role="group" aria-label={`${view.year}년 ${view.month + 1}월`}>
        {WEEKDAY.map((w) => (
          <span key={w} className="calendar-weekday" aria-hidden="true">
            {w}
          </span>
        ))}
        {cells.map((day, i) => {
          if (day == null) return <span key={`blank-${i}`} />
          const future = dayNumber(day) > dayNumber(today)
          const tooLong = first != null && spanDays(first, day) > MAX_CUSTOM_DAYS
          const inRange = from && dayNumber(day) >= dayNumber(from) && dayNumber(day) <= dayNumber(to)
          const edge = from && (day === from || day === to)
          const label = `${parse(day).year}년 ${parse(day).month + 1}월 ${parse(day).day}일`
          return (
            <button
              key={day}
              type="button"
              className={`calendar-day${inRange ? ' in-range' : ''}${edge ? ' edge' : ''}${day === today ? ' today' : ''}`}
              disabled={future || tooLong}
              aria-label={label}
              aria-pressed={Boolean(edge)}
              onClick={() => choose(day)}
              onMouseEnter={() => setHover(day)}
              onMouseLeave={() => setHover(null)}
            >
              {parse(day).day}
            </button>
          )
        })}
      </div>
      <p className="calendar-hint" role="status">
        {first
          ? `종료일을 고르세요. 같은 날을 다시 누르면 그날 하루만 봅니다. (최대 ${MAX_CUSTOM_DAYS}일)`
          : '시작일을 고르세요.'}
      </p>
    </div>
  )
}

// 기간 탭 줄의 "직접 지정" 탭: 누르면 아래에 캘린더가 열리고, 기간을 고르면 닫히며 탭에 그 기간이 보인다.
// 바깥을 누르거나 Esc를 눌러도 닫힌다. 고르지 않고 닫으면 지금 보던 기간은 그대로다.
export function CustomRangeTab({ today, range, onPick }) {
  const [open, setOpen] = useState(false)
  const wrap = useRef(null)
  const active = Boolean(range)

  useEffect(() => {
    if (!open) return undefined
    const outside = (event) => {
      if (wrap.current && !wrap.current.contains(event.target)) setOpen(false)
    }
    const escape = (event) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="range-custom" role="presentation" ref={wrap}>
      <button
        type="button"
        role="tab"
        aria-selected={active}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`status-tab ${active ? 'active' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        {active ? rangeLabel(range.start, range.end, today) : '직접 지정'}
      </button>
      {open && (
        <div className="calendar-pop" role="dialog" aria-label="기간 직접 지정">
          <Calendar
            today={today}
            selected={range}
            onPick={(start, end) => {
              setOpen(false)
              onPick(start, end)
            }}
          />
        </div>
      )}
    </div>
  )
}
