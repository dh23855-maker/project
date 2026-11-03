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
    mockServer({
      ...baseRoutes(makeDetail()),
      'GET /api/evaluations': [],
    })
    renderApp('/evaluation')
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
    mockServer({ ...baseRoutes(makeDetail()), 'GET /api/logs': [], 'GET /api/action-logs': [], 'GET /api/evaluations': [] })
    renderApp('/')
    const menu = within(await screen.findByRole('navigation', { name: '메뉴' }))
    const pill = () => document.querySelector('.nav-pill')
    expect(pill()).toHaveAttribute('aria-hidden', 'true')
    expect(pill().style.transform).toBe('translateX(0px)') // 상담(첫 메뉴)
    expect(pill().style.width).toBe('80px')

    await userEvent.click(menu.getByRole('link', { name: '성능 평가' }))
    expect(pill().style.transform).toBe('translateX(300px)') // 네 번째 메뉴
    // 메뉴를 바꾼 뒤에는 움직임(transition)이 켜져 있다
    expect(pill()).toHaveClass('animate')
    expect(menu.getByRole('link', { name: '성능 평가' })).toHaveClass('active')
    expect(menu.getByRole('link', { name: '상담' })).not.toHaveClass('active')
  })

  it('모든 메뉴 글자는 선택 여부와 상관없이 같은 굵기라 선택해도 글자 너비가 바뀌지 않는다', async () => {
    const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf-8')
    const active = css.match(/\.topbar nav a\.active \{[^}]*\}/)[0]
    expect(active).not.toMatch(/font-weight/)
    expect(css).toMatch(/\.nav-pill\.animate \{[^}]*transition: transform/)
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
