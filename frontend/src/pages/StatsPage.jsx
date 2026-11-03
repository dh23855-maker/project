import { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api.js'
import { PillMark, useSlidingPill } from '../components/SlidingPill.jsx'

export const RANGES = [
  { days: 1, label: '오늘' },
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
export const dots = (iso) => iso.replaceAll('-', '.')

// 칸(날짜 또는 시간) 이름: 날짜는 "2026.11.02 (월)", 시간은 "오늘 9시"
const bucketTitle = (data, bucket) => (data.unit === 'hour' ? `오늘 ${bucket.label}` : longDate(bucket.key))
const bucketAxis = (data, bucket) => (data.unit === 'hour' ? bucket.label : shortDate(bucket.key))

export const percentText = (value) => (value == null ? '-' : `${value.toFixed(1)}%`)

// 분 -> "12분", "1시간 5분", "2일 3시간"
export function formatMinutes(minutes) {
  if (minutes == null) return '-'
  const total = Math.round(minutes)
  if (total < 1) return '1분 미만'
  if (total < 60) return `${total}분`
  if (total < 60 * 24) {
    const m = total % 60
    return `${Math.floor(total / 60)}시간${m ? ` ${m}분` : ''}`
  }
  const hours = Math.floor((total % (60 * 24)) / 60)
  return `${Math.floor(total / (60 * 24))}일${hours ? ` ${hours}시간` : ''}`
}

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
const PAD = { left: 44, right: 12, top: 16, bottom: 36 }

// 가로축 글자를 몇 칸마다 붙일지: 가장 최근 칸부터 거꾸로 세어 마지막 칸에는 항상 붙는다
function labelEvery(data) {
  const n = data.buckets.length
  if (data.unit === 'hour') return 3
  return n <= 7 ? 1 : n <= 14 ? 2 : 5
}

// 날짜(또는 시간)별 쌓은 막대. 칸에 마우스를 올리면 말풍선으로 종류별 건수가 나온다.
function Chart({ data }) {
  const [active, setActive] = useState(null)
  const H = 340
  const codes = data.types.map((t) => t.code)
  const names = Object.fromEntries(data.types.map((t) => [t.code, t.name]))
  const { ticks, top } = niceScale(Math.max(0, ...data.buckets.map((d) => d.total)))
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const band = innerW / data.buckets.length
  const barW = Math.min(band * 0.64, 44)
  const y = (v) => PAD.top + innerH - (v / top) * innerH
  const every = labelEvery(data)
  const unitName = data.unit === 'hour' ? '시간대별' : '날짜별'

  const shown = active == null ? null : data.buckets[active]
  const tipLeft = shown ? ((PAD.left + band * (active + 0.5)) / W) * 100 : 0

  return (
    <div className="chart-wrap" onMouseLeave={() => setActive(null)}>
      <svg
        className="chart"
        viewBox={`0 0 ${W} ${H}`}
        role="group"
        aria-label={`${unitName} 문의 건수 막대 그래프. ${data.start}부터 ${data.end}까지 총 ${data.total}건`}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis-label" x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
              {t}
            </text>
          </g>
        ))}
        {data.buckets.map((bucket, i) => {
          const x = PAD.left + band * i + (band - barW) / 2
          let acc = 0
          const parts = codes.filter((c) => bucket.counts[c] > 0)
          return (
            <g key={bucket.key} className={`column ${active === i ? 'active' : ''}`}>
              {parts.map((code, n) => {
                const height = (bucket.counts[code] / top) * innerH
                acc += bucket.counts[code]
                const segY = y(acc)
                const isTop = n === parts.length - 1
                const common = { fill: seriesColor(code), className: 'segment', 'data-code': code }
                return isTop ? (
                  <path key={code} d={topRounded(x, segY, barW, height, 4)} {...common} />
                ) : (
                  <rect key={code} x={x} y={segY} width={barW} height={height} {...common} />
                )
              })}
              {(data.buckets.length - 1 - i) % every === 0 && (
                <text className="axis-label" x={PAD.left + band * (i + 0.5)} y={H - 12} textAnchor="middle">
                  {bucketAxis(data, bucket)}
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
                aria-label={`${bucketTitle(data, bucket)} ${bucket.total}건${parts.length ? ': ' + parts.map((c) => `${names[c]} ${bucket.counts[c]}건`).join(', ') : ''}`}
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
          <strong>{bucketTitle(data, shown)}</strong>
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
      <table className="table" aria-label={`${data.unit === 'hour' ? '시간대별' : '날짜별'} 문의 건수 표`}>
        <thead>
          <tr>
            <th>{data.unit === 'hour' ? '시간' : '날짜'}</th>
            {data.types.map((t) => (
              <th key={t.code}>{t.name}</th>
            ))}
            <th>합계</th>
          </tr>
        </thead>
        <tbody>
          {[...data.buckets].reverse().map((bucket) => (
            <tr key={bucket.key}>
              <td>{data.unit === 'hour' ? bucket.label : longDate(bucket.key)}</td>
              {data.types.map((t) => (
                <td key={t.code}>{bucket.counts[t.code] || '-'}</td>
              ))}
              <td>
                <strong>{bucket.total}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---- 비율 그래프 (규정 문서에는 없음, 확신도): 한 가지 색으로 크기만 비교한다 ----

// 종류별 가로 막대: 비율이 높은 종류가 위. 문의가 없어 비율을 말할 수 없는 종류는 맨 아래에 "-"로 보여 준다.
function RateBars({ types, rateKey, countKey, wholeKey, label }) {
  const rows = types
    .filter((t) => t.count > 0)
    .map((t) => ({ ...t, rate: t[rateKey], part: t[countKey], whole: t[wholeKey] }))
    .sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.count - a.count)
  return (
    <ul className="rate-bars" aria-label={label}>
      {rows.map((t) => (
        <li key={t.code}>
          <span className="rate-name">{t.name}</span>
          <span className="rate-track" aria-hidden="true">
            <span className="rate-fill" style={{ width: `${t.rate ?? 0}%` }} />
          </span>
          <span className="rate-value">{percentText(t.rate)}</span>
          <span className="muted rate-count">
            {t.part}/{t.whole}건
          </span>
        </li>
      ))}
    </ul>
  )
}

// 칸(날짜·시간)별 비율 막대: 세로축은 0~100%. 문의가 없는 칸은 막대 없이 비워 둔다.
function RateColumns({ data, rateKey, label }) {
  const [active, setActive] = useState(null)
  const H = 220
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const band = innerW / data.buckets.length
  const barW = Math.min(band * 0.64, 44)
  const y = (v) => PAD.top + innerH - (v / 100) * innerH
  const every = labelEvery(data)
  const shown = active == null ? null : data.buckets[active]
  const tipLeft = shown ? ((PAD.left + band * (active + 0.5)) / W) * 100 : 0
  return (
    <div className="chart-wrap" onMouseLeave={() => setActive(null)}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={label}>
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
            <text className="axis-label" x={PAD.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">
              {t}%
            </text>
          </g>
        ))}
        {data.buckets.map((bucket, i) => {
          const rate = bucket[rateKey]
          const x = PAD.left + band * i + (band - barW) / 2
          return (
            <g key={bucket.key} className={`column ${active === i ? 'active' : ''}`}>
              {rate != null && rate > 0 && (
                <path className="segment rate-segment" d={topRounded(x, y(rate), barW, (rate / 100) * innerH, 4)} />
              )}
              {(data.buckets.length - 1 - i) % every === 0 && (
                <text className="axis-label" x={PAD.left + band * (i + 0.5)} y={H - 12} textAnchor="middle">
                  {bucketAxis(data, bucket)}
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
                aria-label={`${label}: ${bucketTitle(data, bucket)} ${percentText(rate)}`}
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
        <div className="chart-tip" style={{ left: `${tipLeft}%` }} data-side={tipLeft > 60 ? 'left' : 'right'} role="status">
          <strong>{bucketTitle(data, shown)}</strong>
          <span className="chart-tip-total">
            {rateKey === 'uncovered_percent'
              ? `규정 문서에는 없음 ${percentText(shown.uncovered_percent)} (${shown.uncovered}/${shown.drafted}건)`
              : `확신도 낮음 ${percentText(shown.low_confidence_percent)} (${shown.low_confidence}/${shown.total}건)`}
          </span>
        </div>
      )}
    </div>
  )
}

// 표로 보기: 종류별 표와 날짜(시간)별 표
function RateTables({ data, rateKey, countKey, wholeKey, headers }) {
  const [partHeader, wholeHeader, rateHeader] = headers
  const table = (title, firstHeader, rows) => (
    <div className="table-scroll">
      <table className="table" aria-label={title}>
        <thead>
          <tr>
            <th>{firstHeader}</th>
            <th>{partHeader}</th>
            <th>{wholeHeader}</th>
            <th>{rateHeader}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.name}</td>
              <td>{r.part}</td>
              <td>{r.whole}</td>
              <td>
                <strong>{percentText(r.rate)}</strong>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
  const byType = data.types
    .filter((t) => t.count > 0)
    .map((t) => ({ key: t.code, name: t.name, part: t[countKey], whole: t[wholeKey], rate: t[rateKey] }))
  const byBucket = [...data.buckets]
    .reverse()
    .map((b) => ({
      key: b.key,
      name: data.unit === 'hour' ? b.label : longDate(b.key),
      part: b[countKey],
      whole: wholeKey === 'count' ? b.total : b[wholeKey],
      rate: b[rateKey],
    }))
  return (
    <>
      <h3 className="sub-title">종류별</h3>
      {table(`종류별 ${rateHeader} 표`, '종류', byType)}
      <h3 className="sub-title">{data.unit === 'hour' ? '시간대별' : '날짜별'}</h3>
      {table(`${data.unit === 'hour' ? '시간대별' : '날짜별'} ${rateHeader} 표`, data.unit === 'hour' ? '시간' : '날짜', byBucket)}
    </>
  )
}

const RESOLUTION = [
  { key: 'approve', label: '초안 그대로 승인', shade: 'dark' },
  { key: 'edit', label: '고쳐서 처리', shade: 'mid' },
  { key: 'manual_write', label: '직접 작성', shade: 'light' },
]

function Handling({ handling }) {
  const { statuses, done, resolution } = handling
  return (
    <>
      <div className="mini-row">
        <div className="mini">
          <span className="mini-label">승인 대기</span>
          <span className="mini-value">{statuses.awaiting_approval}건</span>
        </div>
        <div className="mini">
          <span className="mini-label">직접 작성</span>
          <span className="mini-value">{statuses.manual}건</span>
        </div>
        <div className="mini">
          <span className="mini-label">처리 완료</span>
          <span className="mini-value">{statuses.done}건</span>
        </div>
      </div>

      <h3 className="sub-title">처리 완료한 문의는 어떻게 처리했나</h3>
      {done === 0 ? (
        <p className="muted">아직 처리 완료한 문의가 없습니다.</p>
      ) : (
        <>
          <div className="split-bar" role="img" aria-label={`처리 방법: ${RESOLUTION.map((r) => `${r.label} ${resolution[r.key]}건`).join(', ')}`}>
            {RESOLUTION.filter((r) => resolution[r.key] > 0).map((r) => (
              <span key={r.key} className={`split-part shade-${r.shade}`} style={{ flexGrow: resolution[r.key] }} />
            ))}
          </div>
          <ul className="legend resolution-legend" aria-label="처리 방법">
            {RESOLUTION.map((r) => (
              <li key={r.key}>
                <span className={`swatch shade-${r.shade}`} />
                <span className="legend-name">{r.label}</span>
                <span className="legend-count">{resolution[r.key]}건</span>
                <span className="muted legend-percent">{percentText((resolution[r.key] * 100) / done)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mini-row">
        <div className="mini">
          <span className="mini-label">초안 그대로 승인한 비율</span>
          <span className="mini-value">{percentText(handling.approve_percent)}</span>
          <span className="muted">처리 완료 {done}건 중</span>
        </div>
        <div className="mini">
          <span className="mini-label">재작성한 비율</span>
          <span className="mini-value">{percentText(handling.rewrite_percent)}</span>
          <span className="muted">{handling.rewrite_count}건</span>
        </div>
        <div className="mini">
          <span className="mini-label">처리까지 걸린 시간</span>
          <span className="mini-value">{formatMinutes(handling.median_minutes)}</span>
          <span className="muted">중앙값 · 평균 {formatMinutes(handling.average_minutes)}</span>
        </div>
      </div>
    </>
  )
}

// 문의 현황: 언제 어떤 종류의 문의가 얼마나 들어왔는지, 초안과 처리가 어땠는지 본다.
export default function StatsPage() {
  const [days, setDays] = useState(DEFAULT_DAYS)
  const rangeRef = useRef(null)
  const pill = useSlidingPill(rangeRef, '.status-tab.active', days)
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
    // 같은 건수면 더 최근 칸을 고른다
    const busiest = [...data.buckets].sort((a, b) => b.total - a.total || (a.key < b.key ? 1 : -1))[0]
    return { top, busiest, average: data.total / data.elapsed }
  }, [data])

  const hourly = data?.unit === 'hour'
  const period = data ? (hourly ? `${dots(data.end)} (오늘)` : `${dots(data.start)} ~ ${dots(data.end)}`) : ''

  return (
    <main className="page">
      <h1>문의 현황</h1>
      <p className="muted">언제 어떤 종류의 문의가 얼마나 들어왔는지, 초안과 처리가 어땠는지 봅니다. 문의 종류는 분류 모델이 정한 결과입니다.</p>

      <div className="stats-controls">
        <div className="range-tabs" role="tablist" aria-label="기간" ref={rangeRef}>
          <PillMark box={pill.box} animate={pill.animate} className="tab-pill" />
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
              <p className="muted">이 기간({period})에는 들어온 문의가 없습니다.</p>
            </section>
          ) : (
            <>
              <div className="kpi-row">
                <div className="kpi">
                  <span className="kpi-label">총 문의</span>
                  <span className="kpi-value">{data.total}건</span>
                  <span className="muted">{period}</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">가장 많은 종류</span>
                  <span className="kpi-value">{summary.top.name}</span>
                  <span className="muted">
                    {summary.top.count}건 · {summary.top.percent.toFixed(1)}%
                  </span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">{hourly ? '가장 많이 들어온 시간' : '가장 많이 들어온 날'}</span>
                  <span className="kpi-value">{hourly ? summary.busiest.label : shortDate(summary.busiest.key)}</span>
                  <span className="muted">{summary.busiest.total}건</span>
                </div>
                <div className="kpi">
                  <span className="kpi-label">{hourly ? '시간당 평균' : '하루 평균'}</span>
                  <span className="kpi-value">{summary.average.toFixed(1)}건</span>
                  <span className="muted">{hourly ? '0시부터 지금까지' : '문의 없는 날 포함'}</span>
                </div>
              </div>

              <section className="card">
                <h2>{hourly ? '시간대별 문의 건수' : '날짜별 문의 건수'}</h2>
                {asTable ? <DataTable data={data} /> : <Chart data={data} />}
              </section>

              <section className="card">
                <h2>종류별 합계</h2>
                <Legend types={data.types} />
              </section>

              <section className="card" aria-labelledby="uncovered-title">
                <h2 id="uncovered-title">규정 문서에는 없음 비율</h2>
                <p className="muted card-note">
                  초안이 "규정 문서에는 없음"으로 알린 문의의 비율입니다. 높은 종류일수록 규정 문서를 더 보강해야 합니다.
                </p>
                <p className="headline">
                  <span className="headline-value">{percentText(data.overall.uncovered_percent)}</span>
                  <span className="muted">
                    초안이 있는 문의 {data.overall.drafted}건 중 {data.overall.uncovered}건
                  </span>
                </p>
                {asTable ? (
                  <RateTables
                    data={data}
                    rateKey="uncovered_percent"
                    countKey="uncovered"
                    wholeKey="drafted"
                    headers={['규정 문서에는 없음', '초안 있는 문의', '규정 문서에는 없음 비율']}
                  />
                ) : (
                  <>
                    <h3 className="sub-title">종류별</h3>
                    <RateBars
                      types={data.types}
                      rateKey="uncovered_percent"
                      countKey="uncovered"
                      wholeKey="drafted"
                      label="종류별 규정 문서에는 없음 비율"
                    />
                    <h3 className="sub-title">{hourly ? '시간대별' : '날짜별'}</h3>
                    <RateColumns data={data} rateKey="uncovered_percent" label="규정 문서에는 없음 비율" />
                  </>
                )}
              </section>

              <section className="card" aria-labelledby="confidence-title">
                <h2 id="confidence-title">확신도가 낮은 문의 비율</h2>
                <p className="muted card-note">
                  분류 확신도가 지금의 기준값({data.threshold}%)보다 낮거나 분류를 하지 못한 문의의 비율입니다. 높을수록 분류 모델을 더 보강해야 합니다.
                </p>
                <p className="headline">
                  <span className="headline-value">{percentText(data.overall.low_confidence_percent)}</span>
                  <span className="muted">
                    전체 {data.overall.total}건 중 {data.overall.low_confidence}건
                  </span>
                </p>
                {asTable ? (
                  <RateTables
                    data={data}
                    rateKey="low_confidence_percent"
                    countKey="low_confidence"
                    wholeKey="count"
                    headers={['확신도 낮음', '전체 문의', '확신도가 낮은 문의 비율']}
                  />
                ) : (
                  <>
                    <h3 className="sub-title">종류별</h3>
                    <RateBars
                      types={data.types}
                      rateKey="low_confidence_percent"
                      countKey="low_confidence"
                      wholeKey="count"
                      label="종류별 확신도가 낮은 문의 비율"
                    />
                    <h3 className="sub-title">{hourly ? '시간대별' : '날짜별'}</h3>
                    <RateColumns data={data} rateKey="low_confidence_percent" label="확신도가 낮은 문의 비율" />
                  </>
                )}
              </section>

              <section className="card" aria-labelledby="handling-title">
                <h2 id="handling-title">처리 현황</h2>
                <p className="muted card-note">이 기간에 들어온 문의가 지금 어떤 상태인지, 어떻게 처리됐는지 봅니다.</p>
                <Handling handling={data.handling} />
              </section>
            </>
          )}
        </div>
      )}
    </main>
  )
}
