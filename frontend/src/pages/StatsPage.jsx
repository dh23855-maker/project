import { useEffect, useMemo, useState } from 'react'
import { api } from '../api.js'

export const RANGES = [
  { days: 7, label: '최근 7일' },
  { days: 14, label: '최근 14일' },
  { days: 30, label: '최근 30일' },
]
export const DEFAULT_DAYS = 14

// 종류마다 자리(색)가 정해져 있다. 색은 종류를 따라가고, 건수 순위나 보이는 개수가 바뀌어도 바뀌지 않는다.
export const SERIES_SLOT = {
  buyer_delivery: 1,
  buyer_inspection_result: 2,
  buyer_cancel_refund: 3,
  buyer_payment: 4,
  seller_inspection_fail: 5,
  seller_penalty: 6,
  seller_settlement: 7,
  none: 8,
}
const seriesColor = (code) => `var(--series-${SERIES_SLOT[code] ?? 8})`

const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토']
const parse = (iso) => new Date(`${iso}T00:00:00`)
export const shortDate = (iso) => `${iso.slice(5, 7)}.${iso.slice(8, 10)}`
export const longDate = (iso) => `${iso.slice(0, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)} (${WEEKDAY[parse(iso).getDay()]})`

// 세로축 눈금: 1, 2, 5, 10 단위로 딱 떨어지게 (최소 4칸까지는 보이도록)
export function niceScale(max) {
  const top = Math.max(max, 4)
  const rough = top / 4
  const magnitude = 10 ** Math.floor(Math.log10(rough))
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough)
  const ticks = []
  for (let v = 0; ; v += step) {
    ticks.push(v)
    if (v >= top) break
  }
  return { ticks, top: ticks[ticks.length - 1] }
}

// 위쪽 모서리만 둥근 막대
function topRounded(x, y, w, h, r) {
  const radius = Math.min(r, h / 2, w / 2)
  return `M${x},${y + h} V${y + radius} Q${x},${y} ${x + radius},${y} H${x + w - radius} Q${x + w},${y} ${x + w},${y + radius} V${y + h} Z`
}

const W = 820
const H = 340
const PAD = { left: 44, right: 12, top: 16, bottom: 36 }

function Chart({ data }) {
  const [active, setActive] = useState(null)
  const codes = data.types.map((t) => t.code)
  const names = Object.fromEntries(data.types.map((t) => [t.code, t.name]))
  const { ticks, top } = niceScale(Math.max(0, ...data.daily.map((d) => d.total)))
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const band = innerW / data.daily.length
  const barW = Math.min(band * 0.64, 44)
  const y = (v) => PAD.top + innerH - (v / top) * innerH
  const labelEvery = data.daily.length <= 7 ? 1 : data.daily.length <= 14 ? 2 : 5

  const shown = active == null ? null : data.daily[active]
  const tipLeft = shown ? ((PAD.left + band * (active + 0.5)) / W) * 100 : 0

  return (
    <div className="chart-wrap" onMouseLeave={() => setActive(null)}>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`날짜별 문의 건수 막대 그래프. ${data.start}부터 ${data.end}까지 총 ${data.total}건`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis-label" x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        {data.daily.map((day, i) => {
          const x = PAD.left + band * i + (band - barW) / 2
          let acc = 0
          const parts = codes.filter((c) => day.counts[c] > 0)
          return (
            <g key={day.date} className={`column ${active === i ? 'active' : ''}`}>
              {parts.map((code, n) => {
                const height = (day.counts[code] / top) * innerH
                acc += day.counts[code]
                const segY = y(acc)
                const isTop = n === parts.length - 1
                const common = { fill: seriesColor(code), className: 'segment', 'data-code': code }
                return isTop ? (
                  <path key={code} d={topRounded(x, segY, barW, height, 4)} {...common} />
                ) : (
                  <rect key={code} x={x} y={segY} width={barW} height={height} {...common} />
                )
              })}
              {(data.daily.length - 1 - i) % labelEvery === 0 && ( // 가장 최근 날짜부터 거꾸로 세어 항상 마지막 날짜에 글자가 있다
                <text className="axis-label" x={PAD.left + band * (i + 0.5)} y={H - 12} textAnchor="middle">
                  {shortDate(day.date)}
                </text>
              )}
              <rect
                className="hit"
                x={PAD.left + band * i}
                y={PAD.top}
                width={band}
                height={innerH + 22}
                tabIndex={0}
                role="img"
                aria-label={`${longDate(day.date)} ${day.total}건${parts.length ? ': ' + parts.map((c) => `${names[c]} ${day.counts[c]}건`).join(', ') : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseMove={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive(null)}
              />
            </g>
          )
        })}
        <line className="baseline" x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} />
      </svg>

      {shown && (
        <div
          className="chart-tip"
          role="status"
          style={{ left: `${tipLeft}%` }}
          data-side={tipLeft > 60 ? 'left' : 'right'}
        >
          <strong>{longDate(shown.date)}</strong>
          <span className="chart-tip-total">총 {shown.total}건</span>
          <ul>
            {codes
              .filter((c) => shown.counts[c] > 0)
              .map((c) => (
                <li key={c}>
                  <span className="swatch" style={{ background: seriesColor(c) }} />
                  {names[c]} <b>{shown.counts[c]}</b>
                </li>
              ))}
            {shown.total === 0 && <li className="muted">문의 없음</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

function Legend({ types }) {
  const ranked = [...types].sort((a, b) => b.count - a.count)
  return (
    <ul className="legend" aria-label="종류별 합계">
      {ranked.map((t) => (
        <li key={t.code}>
          <span className="swatch" style={{ background: seriesColor(t.code) }} />
          <span className="legend-name">
            {t.name}
            {t.who && <span className="muted legend-who"> {t.who}</span>}
          </span>
          <span className="legend-count">{t.count}건</span>
          <span className="muted legend-percent">{t.percent.toFixed(1)}%</span>
        </li>
      ))}
    </ul>
  )
}

function DataTable({ data }) {
  return (
    <div className="table-scroll">
      <table className="table" aria-label="날짜별 문의 건수 표">
        <thead>
          <tr>
            <th>날짜</th>
            {data.types.map((t) => (
              <th key={t.code}>{t.name}</th>
            ))}
            <th>합계</th>
          </tr>
        </thead>
        <tbody>
          {[...data.daily].reverse().map((day) => (
            <tr key={day.date}>
              <td>{longDate(day.date)}</td>
              {data.types.map((t) => (
                <td key={t.code}>{day.counts[t.code] || '-'}</td>
              ))}
              <td>
                <strong>{day.total}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// 문의 현황: 날짜별로 어떤 종류의 문의가 얼마나 들어왔는지 막대 그래프로 본다.
export default function StatsPage() {
  const [days, setDays] = useState(DEFAULT_DAYS)
  const [data, setData] = useState(null)
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')
  const [asTable, setAsTable] = useState(false)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    setError('')
    api
      .getInquiryStats(days)
      .then((result) => {
        if (cancelled) return
        setData(result)
        setState('ready')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message)
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [days])

  const summary = useMemo(() => {
    if (!data || data.total === 0) return null
    const top = [...data.types].sort((a, b) => b.count - a.count)[0]
    // 같은 건수면 더 최근 날짜를 고른다
    const busiest = [...data.daily].sort((a, b) => b.total - a.total || (a.date < b.date ? 1 : -1))[0]
    return { top, busiest, average: data.total / data.days }
  }, [data])

  return (
    <main className="page">
      <h1>문의 현황</h1>
      <p className="muted">날짜별로 어떤 종류의 문의가 얼마나 들어왔는지 봅니다. 문의 종류는 분류 모델이 정한 결과입니다.</p>

      <div className="stats-controls">
        <div className="range-tabs" role="tablist" aria-label="기간">
          {RANGES.map((r) => (
            <button
              key={r.days}
              type="button"
              role="tab"
              aria-selected={days === r.days}
              className={`status-tab ${days === r.days ? 'active' : ''}`}
              onClick={() => setDays(r.days)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn-small" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>
          {asTable ? '그래프로 보기' : '표로 보기'}
        </button>
      </div>

      {state === 'error' && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {state === 'loading' && !data && <p className="muted pad">불러오는 중...</p>}

      {data && (
        <div aria-busy={state === 'loading'}>
          {data.total === 0 ? (
            <section className="card">
              <p className="muted">
                이 기간({data.start.replaceAll('-', '.')} ~ {data.end.replaceAll('-', '.')})에는 들어온 문의가 없습니다.
              </p>
            </section>
          ) : (
            <>
              <div className="kpi-row">
                <div className="kpi">
                  <span className="kpi-label">총 문의</span>
                  <span className="kpi-value">{data.total}건</span>
                  <span className="muted">
                    {data.start.replaceAll('-', '.')} ~ {data.end.replaceAll('-', '.')}
                  </span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">가장 많은 종류</span>
                  <span className="kpi-value">{summary.top.name}</span>
                  <span className="muted">
                    {summary.top.count}건 · {summary.top.percent.toFixed(1)}%
                  </span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">가장 많이 들어온 날</span>
                  <span className="kpi-value">{shortDate(summary.busiest.date)}</span>
                  <span className="muted">{summary.busiest.total}건</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">하루 평균</span>
                  <span className="kpi-value">{summary.average.toFixed(1)}건</span>
                  <span className="muted">문의 없는 날 포함</span>
                </div>
              </div>

              <section className="card">
                <h2>날짜별 문의 건수</h2>
                {asTable ? <DataTable data={data} /> : <Chart data={data} />}
              </section>

              <section className="card">
                <h2>종류별 합계</h2>
                <Legend types={data.types} />
              </section>
            </>
          )}
        </div>
      )}
    </main>
  )
}
