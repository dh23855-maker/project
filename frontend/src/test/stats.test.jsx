import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { niceScale, longDate, shortDate } from '../pages/StatsPage.jsx'
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

// 날짜 7개(2026-10-28 ~ 11-03), 11-02에 배송 3건·페널티 1건, 11-03에 배송 1건·정산 2건
function makeStats(days = 7, overrides = {}) {
  const dates = []
  for (let i = 0; i < days; i++) {
    const d = new Date(2026, 10, 3 - (days - 1 - i))
    dates.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  const blank = () => Object.fromEntries(TYPES.map(([code]) => [code, 0]))
  const daily = dates.map((date) => ({ date, total: 0, counts: blank() }))
  const put = (date, code, n) => {
    const day = daily.find((d) => d.date === date)
    day.counts[code] += n
    day.total += n
  }
  put('2026-11-02', 'buyer_delivery', 3)
  put('2026-11-02', 'seller_penalty', 1)
  put('2026-11-03', 'buyer_delivery', 1)
  put('2026-11-03', 'seller_settlement', 2)
  const total = daily.reduce((sum, d) => sum + d.total, 0)
  const counts = Object.fromEntries(TYPES.map(([code]) => [code, daily.reduce((s, d) => s + d.counts[code], 0)]))
  return {
    days,
    start: dates[0],
    end: dates[dates.length - 1],
    total,
    types: TYPES.map(([code, name, who]) => ({
      code,
      name,
      who,
      count: counts[code],
      percent: total ? Math.round((counts[code] * 1000) / total) / 10 : 0,
    })),
    daily,
    ...overrides,
  }
}

const routes = (extra = {}) => ({
  'GET /api/auth/me': agent,
  'GET /api/stats/inquiries?days=14': makeStats(14),
  'GET /api/stats/inquiries?days=7': makeStats(7),
  'GET /api/stats/inquiries?days=30': makeStats(30),
  ...extra,
})

describe('문의 현황 화면', () => {
  it('상단 메뉴에 "문의 현황"이 작업 기록과 성능 평가 사이에 있고 누르면 열린다', async () => {
    mockServer({ ...routes(), 'GET /api/inquiries': [] })
    renderApp('/logs')
    await screen.findByRole('heading', { name: '작업 기록' }).catch(() => null)
    const menu = within(screen.getByRole('navigation', { name: '메뉴' }))
    expect(menu.getAllByRole('link').map((a) => a.textContent)).toEqual(['상담', '작업 기록', '문의 현황', '성능 평가', '설정'])
    await userEvent.click(menu.getByRole('link', { name: '문의 현황' }))
    expect(await screen.findByRole('heading', { name: '문의 현황' })).toBeInTheDocument()
  })

  it('처음에는 최근 14일을 보여 주고, 건수 요약과 날짜별 막대, 종류별 합계가 나온다', async () => {
    const server = mockServer(routes())
    renderApp('/stats')
    expect(await screen.findByRole('heading', { name: '날짜별 문의 건수' })).toBeInTheDocument()
    expect(server.called('GET', '/api/stats/inquiries?days=14')).toHaveLength(1)
    expect(screen.getByRole('tab', { name: '최근 14일' })).toHaveAttribute('aria-selected', 'true')

    // 요약: 총 7건, 가장 많은 종류는 배송(4건), 가장 많이 들어온 날은 11.02(4건), 하루 평균 0.5
    const kpi = (label) => screen.getByText(label).closest('.kpi')
    expect(within(kpi('총 문의')).getByText('7건')).toBeInTheDocument()
    expect(within(kpi('가장 많은 종류')).getByText('배송')).toBeInTheDocument()
    expect(within(kpi('가장 많은 종류')).getByText(/4건 · 57\.1%/)).toBeInTheDocument()
    expect(within(kpi('가장 많이 들어온 날')).getByText('11.02')).toBeInTheDocument()
    expect(within(kpi('가장 많이 들어온 날')).getByText('4건')).toBeInTheDocument()
    expect(within(kpi('하루 평균')).getByText('0.5건')).toBeInTheDocument()

    // 종류별 합계는 건수가 많은 순서
    const legend = within(screen.getByRole('list', { name: '종류별 합계' }))
    const names = legend.getAllByRole('listitem').map((li) => li.querySelector('.legend-name').textContent.trim())
    expect(names.slice(0, 3)).toEqual(['배송 구매자', '정산 판매자', '페널티 판매자'])
    expect(legend.getAllByRole('listitem')).toHaveLength(7)
  })

  it('날짜마다 막대 칸이 있고 읽을 수 있는 설명이 붙어 있다', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })
    const columns = screen.getAllByRole('img').filter((el) => el.classList.contains('hit'))
    expect(columns).toHaveLength(14)
    expect(screen.getByRole('img', { name: '2026.11.02 (월) 4건: 배송 3건, 페널티 1건' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2026.11.03 (화) 3건: 배송 1건, 정산 2건' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: '2026.10.31 (토) 0건' })).toBeInTheDocument()
  })

  it('가로축 날짜 글자는 가장 최근 날짜(오늘)에 항상 붙고, 기간이 길면 띄엄띄엄 붙는다', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })
    const labels = () => [...document.querySelectorAll('svg.chart text.axis-label')].map((t) => t.textContent).filter((t) => /^\d\d\.\d\d$/.test(t))
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
    // 문의가 없는 종류는 막대로 그리지 않는다
    expect(document.querySelectorAll('.segment[data-code="buyer_payment"]')).toHaveLength(0)
  })

  it('날짜 칸에 마우스를 올리면 그날의 건수가 종류별로 나오고, 벗어나면 사라진다', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()

    const hit = screen.getByRole('img', { name: /^2026\.11\.02/ })
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
    screen.getByRole('img', { name: /^2026\.11\.03/ }).focus()
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
    expect(screen.getAllByRole('img').filter((el) => el.classList.contains('hit'))).toHaveLength(7)

    await userEvent.click(screen.getByRole('tab', { name: '최근 30일' }))
    await screen.findByText('2026.10.05 ~ 2026.11.03')
    expect(screen.getAllByRole('img').filter((el) => el.classList.contains('hit'))).toHaveLength(30)
  })

  it('[표로 보기]를 누르면 같은 숫자가 표로 나오고, 다시 누르면 그래프로 돌아온다', async () => {
    mockServer(routes())
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })

    await userEvent.click(screen.getByRole('button', { name: '표로 보기' }))
    const table = within(screen.getByRole('table', { name: '날짜별 문의 건수 표' }))
    const headers = table.getAllByRole('columnheader').map((h) => h.textContent)
    expect(headers).toEqual(['날짜', ...TYPES.map(([, name]) => name), '합계'])
    // 가장 최근 날짜가 맨 위
    const rows = table.getAllByRole('row')
    expect(rows[1]).toHaveTextContent('2026.11.03 (화)')
    expect(within(rows[1]).getAllByRole('cell').map((c) => c.textContent)).toEqual(['2026.11.03 (화)', '1', '-', '-', '-', '-', '-', '2', '3'])
    expect(document.querySelector('svg.chart')).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '그래프로 보기' }))
    expect(document.querySelector('svg.chart')).not.toBeNull()
  })

  it('문의가 하나도 없는 기간은 안내만 보여 준다', async () => {
    const empty = makeStats(14)
    empty.total = 0
    empty.daily.forEach((d) => {
      d.total = 0
      Object.keys(d.counts).forEach((k) => (d.counts[k] = 0))
    })
    empty.types.forEach((t) => ((t.count = 0), (t.percent = 0)))
    mockServer(routes({ 'GET /api/stats/inquiries?days=14': empty }))
    renderApp('/stats')
    expect(await screen.findByText(/들어온 문의가 없습니다/)).toBeInTheDocument()
    expect(document.querySelector('svg.chart')).toBeNull()
  })

  it('불러오지 못하면 서버의 안내를 그대로 보여 준다', async () => {
    mockServer(routes({ 'GET /api/stats/inquiries?days=14': jsonResponse(400, { detail: '기간은 7, 14, 30일 중에서 고르세요.' }) }))
    renderApp('/stats')
    expect(await screen.findByRole('alert')).toHaveTextContent('기간은 7, 14, 30일 중에서 고르세요.')
  })

  it('분류 없음 문의가 있으면 회색 칸과 합계에 나온다', async () => {
    const stats = makeStats(14)
    stats.types.push({ code: 'none', name: '분류 없음', who: '', count: 1, percent: 12.5 })
    stats.total += 1
    stats.daily[13].counts.none = 1
    stats.daily[13].total += 1
    stats.daily.forEach((d) => (d.counts.none ??= 0))
    mockServer(routes({ 'GET /api/stats/inquiries?days=14': stats }))
    renderApp('/stats')
    await screen.findByRole('heading', { name: '날짜별 문의 건수' })
    expect(document.querySelectorAll('.segment[data-code="none"]')[0].getAttribute('fill')).toBe('var(--series-8)')
    expect(within(screen.getByRole('list', { name: '종류별 합계' })).getByText('분류 없음')).toBeInTheDocument()
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
})
