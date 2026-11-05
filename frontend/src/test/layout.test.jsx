import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { baseRoutes, makeDetail, makeDone, mockServer, renderApp, agent } from './utils.jsx'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('상단 이름 버튼', () => {
  it('"고동동 CS"를 누르면 어느 화면에서든 상담 화면으로 이동한다', async () => {
    mockServer({ ...baseRoutes(makeDetail()), 'GET /api/logs': [], 'GET /api/action-logs': [] })
    renderApp('/logs')
    const brand = await screen.findByRole('link', { name: '고동동 CS 상담 화면으로 이동' })
    expect(brand).toHaveAttribute('href', '/')
    expect(brand).toHaveTextContent('고동동 CS')
    await userEvent.click(brand)
    expect(await screen.findByRole('heading', { name: '받은 문의' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '상담' })).toHaveClass('active')
  })
})

describe('메뉴의 선택 표시', () => {
  const stubOffsets = () => {
    // jsdom은 글자 위치를 계산하지 않으므로 메뉴 순서대로 100px 간격의 위치를 흉내 낸다
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function () {
      return [...(this.parentElement?.querySelectorAll('a') ?? [])].indexOf(this) * 100
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
      return this.tagName === 'A' ? 80 : 0
    })
  }

  it('선택 표시(알약)가 있고 메뉴를 바꾸면 그 메뉴 위치로 옮겨 간다', async () => {
    stubOffsets()
    mockServer({ ...baseRoutes(makeDetail()), 'GET /api/logs': [], 'GET /api/action-logs': [] })
    renderApp('/')
    const menu = within(await screen.findByRole('navigation', { name: '메뉴' }))
    const pill = () => document.querySelector('.nav-pill')
    expect(pill()).toHaveAttribute('aria-hidden', 'true')
    expect(pill().style.transform).toBe('translateX(0px)') // 상담(첫 메뉴)
    expect(pill().style.width).toBe('80px')

    await userEvent.click(menu.getByRole('link', { name: '문의 현황' }))
    expect(pill().style.transform).toBe('translateX(200px)') // 세 번째 메뉴
    // 메뉴를 바꾼 뒤에는 움직임(transition)이 켜져 있다
    expect(pill()).toHaveClass('animate')
    expect(menu.getByRole('link', { name: '문의 현황' })).toHaveClass('active')
    expect(menu.getByRole('link', { name: '상담' })).not.toHaveClass('active')
  })

  it('모든 메뉴 글자는 선택 여부와 상관없이 같은 굵기라 선택해도 글자 너비가 바뀌지 않는다', async () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf-8')
    const active = css.match(/\.topbar nav a\.active \{[^}]*\}/)[0]
    expect(active).not.toMatch(/font-weight/)
    expect(css).toMatch(/\.slide-pill\.animate \{[^}]*transition: transform/)
  })
})

// 받은 문의의 상태 탭과 문의 현황의 기간 탭도 메뉴처럼 선택 표시(알약)가 미끄러지듯 옮겨 간다
describe('탭의 선택 표시(알약)', () => {
  const stubTabs = () => {
    // jsdom은 위치를 계산하지 않으므로 탭 순서대로 100px 간격의 위치를 흉내 낸다
    vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function () {
      return [...(this.parentElement?.querySelectorAll('[role="tab"]') ?? [])].indexOf(this) * 100
    })
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function () {
      return this.getAttribute('role') === 'tab' ? 90 : 0
    })
  }
  const pillOf = (tablistName) => within(screen.getByRole('tablist', { name: tablistName })).getByText('', { selector: '.slide-pill' })

  it('받은 문의: 처음에는 움직임 없이 "전체" 자리에 있고, 탭을 바꾸면 그 탭 자리로 옮겨 간다', async () => {
    stubTabs()
    mockServer(baseRoutes(makeDetail()))
    renderApp('/')
    await screen.findByRole('heading', { name: '문의 #1' })
    const pill = pillOf('상태별 보기')
    expect(pill).toHaveAttribute('aria-hidden', 'true')
    expect(pill.style.transform).toBe('translateX(0px)')
    expect(pill.style.width).toBe('90px')
    expect(pill).not.toHaveClass('animate')

    await userEvent.click(screen.getByRole('tab', { name: /처리 완료/ }))
    expect(pillOf('상태별 보기').style.transform).toBe('translateX(300px)') // 네 번째 탭
    expect(pillOf('상태별 보기')).toHaveClass('animate')
    // 선택된 탭 자체에는 배경색을 직접 칠하지 않는다 (알약이 대신한다)
    const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf-8')
    expect(css.match(/\.status-tab\.active \{[^}]*\}/)[0]).not.toMatch(/background/)
  })

  it('문의 현황: 기간을 바꾸면 선택 표시가 그 기간 자리로 옮겨 간다', async () => {
    stubTabs()
    mockServer({
      ...baseRoutes(makeDetail()),
      'GET /api/stats/inquiries': { days: 14, unit: 'day', start: '2026-10-21', end: '2026-11-03', buckets: [], types: [], overall: null, handling: null, elapsed: null, threshold: 0.6 },
    })
    renderApp('/stats')
    await screen.findByRole('heading', { name: '문의 현황' })
    const pill = () => pillOf('기간')
    expect(pill().style.transform).toBe('translateX(200px)') // 기본값 최근 14일은 세 번째
    expect(pill()).not.toHaveClass('animate')

    await userEvent.click(screen.getByRole('tab', { name: '오늘' }))
    expect(pill().style.transform).toBe('translateX(0px)')
    expect(pill()).toHaveClass('animate')
    expect(screen.getByRole('tab', { name: '오늘' })).toHaveClass('active')
  })

  it('목록 너비를 바꾸는 등 칸 크기가 바뀔 때는 움직임 없이 따라간다', async () => {
    stubTabs()
    const callbacks = [] // 메뉴와 탭이 각자 지켜본다
    const notify = (entries) => callbacks.forEach((callback) => callback(entries))
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback) {
          callbacks.push(callback)
        }
        observe() {}
        disconnect() {}
      },
    )
    mockServer(baseRoutes(makeDetail()))
    renderApp('/')
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(screen.getByRole('tab', { name: /처리 완료/ }))
    expect(pillOf('상태별 보기')).toHaveClass('animate')
    act(() => notify([])) // 시작할 때 오는 첫 알림은 크기가 바뀐 것이 아니다
    expect(pillOf('상태별 보기')).toHaveClass('animate')
    act(() => notify([])) // 실제로 크기가 바뀌면 움직임을 끄고 바로 맞춘다
    expect(pillOf('상태별 보기')).not.toHaveClass('animate')
  })
})

describe('버튼 자리(처리 버튼이 글씨를 덮지 않게)', () => {
  // 브라우저의 "화면에 보이는지 지켜보기" 기능을 흉내 낸다
  const stubObserver = () => {
    const observers = []
    class FakeObserver {
      constructor(callback) {
        this.callback = callback
        this.disconnected = false
        observers.push(this)
      }
      observe() {}
      disconnect() {
        this.disconnected = true
      }
    }
    vi.stubGlobal('IntersectionObserver', FakeObserver)
    const live = () => observers.filter((o) => !o.disconnected).at(-1)
    return { show: (visible) => act(() => live().callback([{ isIntersecting: visible }])), observers }
  }
  const dock = () => within(document.querySelector('.action-dock'))

  it('버튼 자리가 보이면 아래에 따로 붙이지 않는다 (글씨 위를 덮지 않는다)', async () => {
    stubObserver()
    mockServer(baseRoutes(makeDetail()))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    expect(document.querySelector('.action-dock')).toBeEmptyDOMElement()
    expect(screen.getAllByRole('button', { name: '승인' })).toHaveLength(1)
  })

  it('버튼 자리가 화면 밖으로 나가면 내용 칸 아래에 같은 버튼이 나타나고, 돌아오면 사라진다', async () => {
    const { show } = stubObserver()
    const server = mockServer(baseRoutes(makeDetail(), { 'POST /api/inquiries/1/approve': makeDone() }))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })

    show(false)
    expect(dock().getAllByRole('button').map((b) => b.textContent)).toEqual(['승인', '수정', '재작성'])
    // 아래에 붙은 버튼은 내용 칸 바깥에 있다
    expect(document.querySelector('.consult-scroll').contains(document.querySelector('.action-dock'))).toBe(false)
    expect(screen.getAllByRole('button', { name: '승인' })).toHaveLength(2)

    await userEvent.click(dock().getByRole('button', { name: '승인' })) // 아래 버튼도 똑같이 동작한다
    expect(server.called('POST', '/api/inquiries/1/approve')).toHaveLength(1)
    expect(await screen.findByText('승인했습니다.')).toBeInTheDocument()
  })

  it('다시 보이게 되면 아래 버튼이 사라진다', async () => {
    const { show } = stubObserver()
    mockServer(baseRoutes(makeDetail()))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    show(false)
    expect(dock().getAllByRole('button')).toHaveLength(3)
    show(true)
    expect(document.querySelector('.action-dock')).toBeEmptyDOMElement()
  })

  it('수정하는 중에는 아래 버튼이 나타나지 않는다', async () => {
    const { show } = stubObserver()
    mockServer(baseRoutes(makeDetail()))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(screen.getAllByRole('button', { name: '수정' })[0])
    expect(screen.getByLabelText('답장 내용')).toBeInTheDocument()
    expect(document.querySelector('.action-dock')).toBeEmptyDOMElement()
    // 지켜보기가 "안 보임"을 알려 와도 마찬가지 (수정 중에는 버튼 자리가 없다)
    await act(async () => {})
    expect(document.querySelector('.action-dock')).toBeEmptyDOMElement()
    void show
  })

  it('처리 완료 문의의 [다시 수정]도 같은 방식으로 아래에 나타난다', async () => {
    const { show } = stubObserver()
    mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': [{ ...makeDone(), drafts: undefined }],
      'GET /api/inquiries/1': makeDone(),
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    expect(screen.getAllByRole('button', { name: '다시 수정' })).toHaveLength(1)
    show(false)
    expect(dock().getByRole('button', { name: '다시 수정' })).toBeInTheDocument()
  })

  it('지켜보기 기능이 없는 환경에서도 문제 없이 열린다', async () => {
    vi.stubGlobal('IntersectionObserver', undefined)
    mockServer(baseRoutes(makeDetail()))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    expect(screen.getAllByRole('button', { name: '승인' })).toHaveLength(1)
  })
})

describe('분류 확신도 낮음 경고 상자', () => {
  const css = () => readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf-8')
  const hex = (name) => {
    const value = css().match(new RegExp(`--${name}:\\s*#([0-9a-fA-F]{6})`))[1]
    return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16))
  }

  it('안내 상자가 회색이 아니라 붉은 계열 경고 상자로 보인다', async () => {
    const note = '분류 확신도가 기준값(70%)보다 낮습니다. 문의 종류가 맞는지 먼저 확인해 주세요.'
    mockServer(baseRoutes(makeDetail({ confidence_percent: 41.2, auto_note: note })))
    renderApp()
    const box = await screen.findByText(note)
    expect(box).toHaveClass('callout', 'callout-alert')
    expect(box).toHaveAttribute('role', 'note')
    expect(box).not.toHaveClass('callout-info')
  })

  it('경고 상자의 배경·테두리·글자 색은 모두 빨강이 가장 강하다 (회색이 아니다)', () => {
    for (const name of ['alert-bg', 'alert-border', 'alert-text']) {
      const [r, g, b] = hex(name)
      expect(r - Math.max(g, b), `${name}의 빨강이 다른 색보다 충분히 강해야 한다`).toBeGreaterThanOrEqual(name === 'alert-bg' ? 10 : 40)
    }
    // 배경은 "살짝" 붉은색: 아주 진하지 않다
    expect(Math.min(...hex('alert-bg'))).toBeGreaterThanOrEqual(200)
    expect(css()).toMatch(/\.callout-alert \{[^}]*background: var\(--alert-bg\)[^}]*border-color: var\(--alert-border\)[^}]*color: var\(--alert-text\)/)
  })
})

describe('승인 대기 / 빠른 승인을 오가도 요소 높이가 변하지 않는다', () => {
  const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf-8')
  const rule = (selector) => css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{[^}]*\\}`))[0]

  it('목록 위 제목 줄은 높이가 고정되어 있어, 빠른 승인 보기에서만 생기는 버튼이 줄을 키우지 않는다', () => {
    const head = rule('.side-head')
    expect(head).toMatch(/height: 53px/)
    expect(head).toMatch(/flex: none/)
    expect(head).toMatch(/align-items: center/)
  })

  it('목록은 스크롤바가 생기거나 없어져도 글이 옆으로 밀리지 않게 자리를 비워 둔다', () => {
    expect(rule('.side-list')).toMatch(/scrollbar-gutter: stable/)
  })
})
