import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatMinutes, longDate, niceScale, percentText, shortDate } from '../pages/StatsPage.jsx'
import { agent, jsonResponse, mockServer, renderApp } from './utils.jsx'

afterEach(() => {
  vi.unstubAllGlobals()
})

const TYPES = [
  ['buyer_delivery', '배송', '구매자'],
  ['buyer_inspection_result', '검수 결과', '구매자'],
  ['buyer_cancel_refund', '취소·환불', '구매자'],
  ['buyer_payment', '결제', '구매자'],
  ['seller_inspection_fail', '검수 불합격', '판매자'],
  ['seller_penalty', '페널티', '판매자'],
  ['seller_settlement', '정산', '판매자'],
]

const pct = (part, whole) => (whole ? Math.round((part * 1000) / whole) / 10 : null)
const blank = () => Object.fromEntries(TYPES.map(([code]) => [code, 0]))
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// 문의 7건 (초안은 모두 있음)
//  날짜: 11-02 배송 3·페널티 1 / 11-03 배송 1·정산 2   (오늘 탭: 9시 배송 3 / 14시 페널티 1·정산 2 / 15시 배송 1)
//  규정 문서에는 없음: 페널티 1건, 정산 1건 -> 7건 중 2건
//  확신도 낮음: 페널티 1건, 배송 1건, 정산 1건 -> 7건 중 3건
const TYPE_STATS = {
  buyer_delivery: { count: 4, uncovered: 0, low: 1 },
  seller_penalty: { count: 1, uncovered: 1, low: 1 },
  seller_settlement: { count: 2, uncovered: 1, low: 1 },
}

function makeStats(days = 14, overrides = {}) {
  const hourly = days === 1
  const keys = hourly
    ? Array.from({ length: 24 }, (_, h) => [String(h).padStart(2, '0'), `${h}시`])
    : Array.from({ length: days }, (_, i) => {
        const key = iso(new Date(2026, 10, 3 - (days - 1 - i)))
        return [key, key]
      })
  const buckets = keys.map(([key, label]) => ({
    key,
    label,
    total: 0,
    counts: blank(),
    drafted: 0,
    uncovered: 0,
    uncovered_percent: null,
    low_confidence: 0,
    low_confidence_percent: null,
  }))
  const put = (key, code, n, { uncovered = 0, low = 0 } = {}) => {
    const b = buckets.find((x) => x.key === key)
    b.counts[code] += n
    b.total += n
    b.drafted += n
    b.uncovered += uncovered
    b.low_confidence += low
  }
  if (hourly) {
    put('09', 'buyer_delivery', 3, { low: 1 })
    put('14', 'seller_penalty', 1, { uncovered: 1, low: 1 })
    put('14', 'seller_settlement', 2, { uncovered: 1, low: 1 })
    put('15', 'buyer_delivery', 1)
  } else {
    put('2026-11-02', 'buyer_delivery', 3)
    put('2026-11-02', 'seller_penalty', 1, { uncovered: 1, low: 1 })
    put('2026-11-03', 'buyer_delivery', 1, { low: 1 })
    put('2026-11-03', 'seller_settlement', 2, { uncovered: 1, low: 1 })
  }
  buckets.forEach((b) => {
    b.uncovered_percent = pct(b.uncovered, b.drafted)
    b.low_confidence_percent = pct(b.low_confidence, b.total)
  })
  const total = 7
  const types = TYPES.map(([code, name, who]) => {
    const s = TYPE_STATS[code] ?? { count: 0, uncovered: 0, low: 0 }
    return {
      code,
      name,
      who,
      count: s.count,
      percent: pct(s.count, total) ?? 0,
      drafted: s.count,
      uncovered: s.uncovered,
      uncovered_percent: pct(s.uncovered, s.count),
      low_confidence: s.low,
      low_confidence_percent: pct(s.low, s.count),
    }
  })
  return {
    days,
    unit: hourly ? 'hour' : 'day',
    elapsed: hourly ? 16 : days,
    start: hourly ? '2026-11-03' : keys[0][0],
    end: '2026-11-03',
    total,
    threshold: 70,
    overall: { total, drafted: 7, uncovered: 2, uncovered_percent: pct(2, 7), low_confidence: 3, low_confidence_percent: pct(3, 7) },
    types,
    buckets,
    handling: {
      statuses: { awaiting_approval: 3, manual: 1, done: 3 },
      done: 3,
      resolution: { approve: 2, edit: 1, manual_write: 0 },
      approve_percent: 66.7,
      rewrite_count: 1,
      rewrite_percent: 14.3,
      median_minutes: 45,
      average_minutes: 135,
    },
    ...overrides,
  }
}

const routes = (extra = {}) => ({
  'GET /api/auth/me': agent,
  'GET /api/stats/inquiries?days=1': makeStats(1),
  'GET /api/stats/inquiries?days=7': makeStats(7),
  'GET /api/stats/inquiries?days=14': makeStats(14),
  'GET /api/stats/inquiries?days=30': makeStats(30),
  ...extra,
})

const hits = () => screen.getAllByRole('img').filter((el) => el.classList.contains('hit'))
const section = (name) => within(screen.getByRole('heading', { name }).closest('section'))

describe('문의 현황 화면', () => {
  it('상단 메뉴에 "문의 현황"이 작업 기록과 성능 평가 사이에 있고 누르면 열린다', async () => {
    mockServer({ ...routes(), 'GET /api/inquiries': [] })
    renderApp('/logs')
    const menu = within(await screen.findByRole('navigation', { name: '메뉴' }))
    expect(menu.getAllByRole('link').map((a) => a.textContent)).toEqual(['상담', '작업 기록', '문의 현황', '성능 평가', '설정'])
    await userEvent.click(menu.getByRole('link', { name: '문의 현황' }))
    expect(await screen.findByRole('heading', { name: '문의 현황' })).toBeInTheDocument()
  })

  it('기간 탭은 오늘 / 최근 7일 / 14일 / 30일이고 처음에는 14일이다', async () => {
    const server = mockServer(routes())
    renderApp('/stats')
    expect(await screen.findByRole('heading', { name: '날짜별 문의 건수' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['오늘', '최근 7일', '최근 14일', '최근 30일'])
    expect(screen.getByRole('tab', { name: '최근 14일' })).toHaveAttribute('aria-selected', 'true')
    expect(server.called('GET', '/api/stats/inquiries?days=14')).toHaveLength(1)
  })

  it('건수 요약과 종류별 합계가 나온다', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })

    // 요약: 총 7건, 가장 많은 종류는 배송(4건), 가장 많이 들어온 날은 11.02(4건), 하루 평균 0.5
    const kpi = (label) => screen.getByText(label).closest('.kpi')
    expect(within(kpi('총 문의')).getByText('7건')).toBeInTheDocument()
    expect(within(kpi('가장 많은 종류')).getByText('배송')).toBeInTheDocument()
    expect(within(kpi('가장 많은 종류')).getByText(/4건 · 57\.1%/)).toBeInTheDocument()
    expect(within(kpi('가장 많이 들어온 날')).getByText('11.02')).toBeInTheDocument()
    expect(within(kpi('가장 많이 들어온 날')).getByText('4건')).toBeInTheDocument()
    expect(within(kpi('하루 평균')).getByText('0.5건')).toBeInTheDocument()

    const legend = within(screen.getByRole('list', { name: '종류별 합계' }))
    const names = legend.getAllByRole('listitem').map((li) => li.querySelector('.legend-name').textContent.trim())
    expect(names.slice(0, 3)).toEqual(['배송 구매자', '정산 판매자', '페널티 판매자'])
    expect(legend.getAllByRole('listitem')).toHaveLength(7)
  })

  it('날짜마다 막대 칸이 있고 읽을 수 있는 설명이 붙어 있다', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })
    expect(hits()).toHaveLength(14 * 3) // 14일 × 3개 그래프(건수, 규정 문서에는 없음, 확신도)
    expect(screen.getByRole('img', { name: '2026.11.02 (월) 4건: 배송 3건, 페널티 1건' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2026.11.03 (화) 3건: 배송 1건, 정산 2건' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2026.10.31 (토) 0건' })).toBeInTheDocument()
  })

  it('가로축 날짜 글자는 가장 최근 날짜(오늘)에 항상 붙고, 기간이 길면 띄엄띄엄 붙는다', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })
    const labels = () =>
      [...section('날짜별 문의 건수').getByRole('group').querySelectorAll('text.axis-label')]
        .map((t) => t.textContent)
        .filter((t) => /^\d\d\.\d\d$/.test(t))
    expect(labels()).toHaveLength(7) // 14일은 이틀에 한 번
    expect(labels().at(-1)).toBe('11.03')
    await userEvent.click(screen.getByRole('tab', { name: '최근 7일' }))
    await screen.findByText('2026.10.28 ~ 2026.11.03')
    expect(labels()).toHaveLength(7) // 7일은 매일
    await userEvent.click(screen.getByRole('tab', { name: '최근 30일' }))
    await screen.findByText('2026.10.05 ~ 2026.11.03')
    expect(labels()).toHaveLength(6) // 30일은 닷새에 한 번
    expect(labels().at(-1)).toBe('11.03')
  })

  it('색은 종류를 따라간다: 배송은 항상 1번 색, 페널티는 6번 색', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })
    const fills = (code) => new Set([...document.querySelectorAll(`.segment[data-code="${code}"]`)].map((el) => el.getAttribute('fill')))
    expect(fills('buyer_delivery')).toEqual(new Set(['var(--series-1)']))
    expect(fills('seller_penalty')).toEqual(new Set(['var(--series-6)']))
    expect(fills('seller_settlement')).toEqual(new Set(['var(--series-7)']))
    expect(document.querySelectorAll('.segment[data-code="buyer_payment"]')).toHaveLength(0)
  })

  it('날짜 칸에 마우스를 올리면 그날의 건수가 종류별로 나오고, 벗어나면 사라진다', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    const hit = screen.getByRole('img', { name: /^2026\.11\.02 \(월\) 4건/ })
    fireEvent.mouseEnter(hit)
    const tip = within(screen.getByRole('status'))
    expect(tip.getByText('2026.11.02 (월)')).toBeInTheDocument()
    expect(tip.getByText('총 4건')).toBeInTheDocument()
    expect(tip.getByText('배송').closest('li')).toHaveTextContent('배송 3')
    expect(tip.getByText('페널티').closest('li')).toHaveTextContent('페널티 1')
    expect(tip.queryByText('정산')).not.toBeInTheDocument()

    fireEvent.mouseLeave(hit.closest('.chart-wrap'))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('키보드로 날짜 칸에 가도 같은 내용이 나온다', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })
    screen.getByRole('img', { name: /^2026\.11\.03 \(화\) 3건/ }).focus()
    expect(await screen.findByText('총 3건')).toBeInTheDocument()
  })

  it('기간을 바꾸면 그 기간의 데이터를 다시 불러온다', async () => {
    const server = mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })

    await userEvent.click(screen.getByRole('tab', { name: '최근 7일' }))
    await screen.findByText('2026.10.28 ~ 2026.11.03')
    expect(server.called('GET', '/api/stats/inquiries?days=7')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: '최근 7일' })).toHaveAttribute('aria-selected', 'true')
    expect(hits()).toHaveLength(7 * 3)

    await userEvent.click(screen.getByRole('tab', { name: '최근 30일' }))
    await screen.findByText('2026.10.05 ~ 2026.11.03')
    expect(hits()).toHaveLength(30 * 3)
  })

  it('[표로 보기]를 누르면 같은 숫자가 표로 나오고, 다시 누르면 그래프로 돌아온다', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })

    await userEvent.click(screen.getByRole('button', { name: '표로 보기' }))
    const table = within(screen.getByRole('table', { name: '날짜별 문의 건수 표' }))
    expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['날짜', ...TYPES.map(([, name]) => name), '합계'])
    const rows = table.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('2026.11.03 (화)') // 가장 최근 날짜가 맨 위
    expect(within(rows[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2026.11.03 (화)', '1', '-', '-', '-', '-', '-', '2', '3'])
    expect(document.querySelector('svg.chart')).toBeNull()
    // 비율 그래프도 표로 바뀐다
    expect(screen.getByRole('table', { name: '종류별 규정 문서에는 없음 비율 표' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: '날짜별 확신도가 낮은 문의 비율 표' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '그래프로 보기' }))
    expect(document.querySelector('svg.chart')).not.toBeNull()
  })

  it('문의가 하나도 없는 기간은 안내만 보여 준다', async () => {
    const empty = makeStats(14)
    empty.total = 0
    mockServer(routes({ 'GET /api/stats/inquiries?days=14': empty }))
    renderApp('/stats')
    expect(await screen.findByText(/들어온 문의가 없습니다/)).toBeInTheDocument()
    expect(document.querySelector('svg.chart')).toBeNull()
  })

  it('불러오지 못하면 서버의 안내를 그대로 보여 준다', async () => {
    mockServer(routes({ 'GET /api/stats/inquiries?days=14': jsonResponse(400, { detail: '기간은 오늘, 7, 14, 30일 중에서 고르세요.' }) }))
    renderApp('/stats')
    expect(await screen.findByRole('alert')).toHaveTextContent('기간은 오늘, 7, 14, 30일 중에서 고르세요.')
  })

  it('분류 없음 문의가 있으면 회색 칸과 합계에 나온다', async () => {
    const stats = makeStats(14)
    stats.types.push({
      code: 'none',
      name: '분류 없음',
      who: '',
      count: 1,
      percent: 12.5,
      drafted: 1,
      uncovered: 0,
      uncovered_percent: 0,
      low_confidence: 1,
      low_confidence_percent: 100,
    })
    stats.total += 1
    stats.buckets.forEach((b) => (b.counts.none = 0))
    stats.buckets[13].counts.none = 1
    stats.buckets[13].total += 1
    mockServer(routes({ 'GET /api/stats/inquiries?days=14': stats }))
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })
    expect(document.querySelectorAll('.segment[data-code="none"]')[0].getAttribute('fill')).toBe('var(--series-8)')
    expect(within(screen.getByRole('list', { name: '종류별 합계' })).getByText('분류 없음')).toBeInTheDocument()
  })
})

describe('문의 현황: 오늘', () => {
  const openToday = async () => {
    const server = mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })
    await userEvent.click(screen.getByRole('tab', { name: '오늘' }))
    await screen.findByRole('heading', { name: '시간대별 문의 건수' })
    return server
  }

  it('오늘 탭은 시간대별(0시~23시)로 보여 주고 시간 이름으로 설명한다', async () => {
    const server = await openToday()
    expect(server.called('GET', '/api/stats/inquiries?days=1')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: '오늘' })).toHaveAttribute('aria-selected', 'true')
    expect(hits()).toHaveLength(24 * 3)
    expect(screen.getByRole('img', { name: '오늘 14시 3건: 페널티 1건, 정산 2건' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '오늘 9시 3건: 배송 3건' })).toBeInTheDocument()
    // 요약도 시간 기준: 가장 많이 들어온 시간, 시간당 평균(0시부터 지금까지 16시간)
    const kpi = (label) => screen.getByText(label).closest('.kpi')
    expect(within(kpi('가장 많이 들어온 시간')).getByText('14시')).toBeInTheDocument() // 같은 3건이면 더 늦은 시간
    expect(within(kpi('시간당 평균')).getByText('0.4건')).toBeInTheDocument() // 7건 / 16시간 = 0.4375
    expect(screen.getByText('0시부터 지금까지')).toBeInTheDocument()
    expect(screen.getByText('2026.11.03 (오늘)')).toBeInTheDocument()
  })

  it('시간대 칸의 말풍선은 "오늘 14시"로 나오고, 가로축은 3시간마다 글자가 붙는다', async () => {
    await openToday()
    fireEvent.mouseEnter(screen.getByRole('img', { name: /^오늘 14시 3건/ }))
    const tip = within(screen.getByRole('status'))
    expect(tip.getByText('오늘 14시')).toBeInTheDocument()
    expect(tip.getByText('정산').closest('li')).toHaveTextContent('정산 2')
    const labels = [...section('시간대별 문의 건수').getByRole('group').querySelectorAll('text.axis-label')]
      .map((t) => t.textContent)
      .filter((t) => /시$/.test(t))
    expect(labels).toHaveLength(8) // 23시부터 3시간씩 거꾸로
    expect(labels.at(-1)).toBe('23시')
  })

  it('오늘 표로 보기는 시간 열을 쓴다', async () => {
    await openToday()
    await userEvent.click(screen.getByRole('button', { name: '표로 보기' }))
    const table = within(screen.getByRole('table', { name: '시간대별 문의 건수 표' }))
    expect(table.getAllByRole('columnheader')[0]).toHaveTextContent('시간')
    expect(within(table.getAllByRole('row')[1]).getAllByRole('cell')[0]).toHaveTextContent('23시') // 가장 늦은 시간이 위
  })
})

describe('문의 현황: 규정 문서에는 없음 · 확신도 · 처리 현황', () => {
  it('규정 문서에는 없음 비율: 전체, 종류별 높은 순, 날짜별 그래프가 나온다', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '규정 문서에는 없음 비율' })
    const card = section('규정 문서에는 없음 비율')
    expect(card.getByText('28.6%')).toBeInTheDocument() // 7건 중 2건
    expect(card.getByText('초안이 있는 문의 7건 중 2건')).toBeInTheDocument()

    const rows = within(card.getByRole('list', { name: '종류별 규정 문서에는 없음 비율' })).getAllByRole('listitem')
    // 비율이 높은 종류가 위: 페널티 100%(1/1), 정산 50%(1/2), 배송 0%(0/4)
    expect(rows.map((r) => r.querySelector('.rate-name').textContent)).toEqual(['페널티', '정산', '배송'])
    expect(rows[0]).toHaveTextContent('100.0%')
    expect(rows[0]).toHaveTextContent('1/1건')
    expect(rows[1]).toHaveTextContent('50.0%')
    expect(rows[2]).toHaveTextContent('0.0%')
    expect(rows[2].querySelector('.rate-fill')).toHaveStyle({ width: '0%' })

    // 날짜별 그래프: 11-02는 25%(1/4), 11-03은 33.3%(1/3), 문의 없는 날은 값 없음
    expect(card.getByRole('img', { name: '규정 문서에는 없음 비율: 2026.11.02 (월) 25.0%' })).toBeInTheDocument()
    expect(card.getByRole('img', { name: '규정 문서에는 없음 비율: 2026.11.03 (화) 33.3%' })).toBeInTheDocument()
    expect(card.getByRole('img', { name: '규정 문서에는 없음 비율: 2026.10.31 (토) -' })).toBeInTheDocument()
    fireEvent.mouseEnter(card.getByRole('img', { name: /^규정 문서에는 없음 비율: 2026\.11\.03/ }))
    expect(within(screen.getByRole('status')).getByText(/규정 문서에는 없음 33\.3% \(1\/3건\)/)).toBeInTheDocument()
  })

  it('확신도가 낮은 문의 비율: 기준값 안내와 전체·종류별·날짜별', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '확신도가 낮은 문의 비율' })
    const card = section('확신도가 낮은 문의 비율')
    expect(card.getByText(/기준값\(70%\)보다 낮거나 분류를 하지 못한/)).toBeInTheDocument()
    expect(card.getByText('42.9%')).toBeInTheDocument() // 7건 중 3건
    expect(card.getByText('전체 7건 중 3건')).toBeInTheDocument()
    const rows = within(card.getByRole('list', { name: '종류별 확신도가 낮은 문의 비율' })).getAllByRole('listitem')
    expect(rows.map((r) => r.querySelector('.rate-name').textContent)).toEqual(['페널티', '정산', '배송'])
    expect(rows[2]).toHaveTextContent('25.0%') // 배송 4건 중 1건
    expect(rows[2]).toHaveTextContent('1/4건')
    expect(card.getByRole('img', { name: '확신도가 낮은 문의 비율: 2026.11.02 (월) 25.0%' })).toBeInTheDocument()
  })

  it('처리 현황: 상태별 건수, 처리 방법 비율, 초안 그대로 승인한 비율, 걸린 시간', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '처리 현황' })
    const card = section('처리 현황')
    const mini = (label) => card.getAllByText(label).map((el) => el.closest('.mini')).find(Boolean)
    expect(within(mini('승인 대기')).getByText('3건')).toBeInTheDocument()
    expect(within(mini('직접 작성')).getByText('1건')).toBeInTheDocument()
    expect(within(mini('처리 완료')).getByText('3건')).toBeInTheDocument()

    expect(card.getByRole('img', { name: '처리 방법: 초안 그대로 승인 2건, 고쳐서 처리 1건, 직접 작성 0건' })).toBeInTheDocument()
    const legend = within(card.getByRole('list', { name: '처리 방법' })).getAllByRole('listitem')
    expect(legend[0]).toHaveTextContent('초안 그대로 승인')
    expect(legend[0]).toHaveTextContent('2건')
    expect(legend[0]).toHaveTextContent('66.7%')
    expect(legend[2]).toHaveTextContent('0.0%')

    expect(within(mini('초안 그대로 승인한 비율')).getByText('66.7%')).toBeInTheDocument()
    expect(within(mini('재작성한 비율')).getByText('14.3%')).toBeInTheDocument()
    expect(within(mini('처리까지 걸린 시간')).getByText('45분')).toBeInTheDocument()
    expect(within(mini('처리까지 걸린 시간')).getByText('중앙값 · 평균 2시간 15분')).toBeInTheDocument()
  })

  it('아직 처리한 문의가 없으면 비율 대신 안내와 "-"를 보여 준다', async () => {
    const stats = makeStats(14)
    stats.handling = {
      statuses: { awaiting_approval: 7, manual: 0, done: 0 },
      done: 0,
      resolution: { approve: 0, edit: 0, manual_write: 0 },
      approve_percent: null,
      rewrite_count: 0,
      rewrite_percent: 0,
      median_minutes: null,
      average_minutes: null,
    }
    mockServer(routes({ 'GET /api/stats/inquiries?days=14': stats }))
    renderApp('/stats')
    await screen.findByRole('heading', { name: '처리 현황' })
    const card = section('처리 현황')
    expect(card.getByText('아직 처리 완료한 문의가 없습니다.')).toBeInTheDocument()
    expect(within(card.getByText('초안 그대로 승인한 비율').closest('.mini')).getByText('-')).toBeInTheDocument()
    expect(within(card.getByText('처리까지 걸린 시간').closest('.mini')).getByText('-')).toBeInTheDocument()
  })

  it('초안이 없는 문의뿐이면 규정 문서에는 없음 비율은 "-"이다', async () => {
    const stats = makeStats(14)
    stats.overall = { ...stats.overall, drafted: 0, uncovered: 0, uncovered_percent: null }
    mockServer(routes({ 'GET /api/stats/inquiries?days=14': stats }))
    renderApp('/stats')
    await screen.findByRole('heading', { name: '규정 문서에는 없음 비율' })
    expect(section('규정 문서에는 없음 비율').getByText('-')).toBeInTheDocument()
  })
})

describe('그래프 계산', () => {
  it('세로축 눈금은 딱 떨어지는 값이고 최소 4까지는 그린다', () => {
    expect(niceScale(0)).toEqual({ ticks: [0, 1, 2, 3, 4], top: 4 })
    expect(niceScale(3)).toEqual({ ticks: [0, 1, 2, 3, 4], top: 4 })
    expect(niceScale(7).top).toBe(8)
    expect(niceScale(13).ticks).toEqual([0, 5, 10, 15])
    expect(niceScale(100).top).toBe(100)
    expect(niceScale(101).top).toBeGreaterThanOrEqual(101)
  })

  it('날짜 표기', () => {
    expect(shortDate('2026-11-03')).toBe('11.03')
    expect(longDate('2026-11-03')).toBe('2026.11.03 (화)')
    expect(longDate('2026-11-01')).toBe('2026.11.01 (일)')
  })

  it('비율과 시간 표기', () => {
    expect(percentText(28.571)).toBe('28.6%')
    expect(percentText(0)).toBe('0.0%')
    expect(percentText(null)).toBe('-')
    expect(formatMinutes(null)).toBe('-')
    expect(formatMinutes(0.2)).toBe('1분 미만')
    expect(formatMinutes(45)).toBe('45분')
    expect(formatMinutes(60)).toBe('1시간')
    expect(formatMinutes(135)).toBe('2시간 15분')
    expect(formatMinutes(60 * 24)).toBe('1일')
    expect(formatMinutes(60 * 24 * 2 + 60 * 3)).toBe('2일 3시간')
  })
})
