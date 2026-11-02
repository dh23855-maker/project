import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent, baseRoutes, jsonResponse, makeDetail, mockServer, renderApp } from './utils.jsx'

afterEach(() => vi.unstubAllGlobals())

const notLoggedIn = jsonResponse(401, { detail: '로그인이 필요합니다.' })

describe('로그인', () => {
  it('로그인하지 않았으면 어느 화면이든 로그인 화면으로 보낸다', async () => {
    mockServer({ 'GET /api/auth/me': notLoggedIn })
    for (const path of ['/', '/logs', '/settings']) {
      renderApp(path)
      expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument()
      expect(screen.queryByRole('navigation', { name: '메뉴' })).not.toBeInTheDocument()
      document.body.innerHTML = ''
    }
  })

  it('틀린 아이디·비밀번호면 서버의 안내를 그대로 보여준다', async () => {
    const server = mockServer({
      'GET /api/auth/me': notLoggedIn,
      'POST /api/auth/login': jsonResponse(401, { detail: '아이디 또는 비밀번호가 맞지 않습니다.' }),
    })
    renderApp()
    await userEvent.type(await screen.findByLabelText('아이디'), 'kim')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'wrong')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('아이디 또는 비밀번호가 맞지 않습니다.')
    expect(server.called('POST', '/api/auth/login')[0].body).toEqual({ username: 'kim', password: 'wrong' })
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument()
  })

  it('빈 입력도 서버의 안내를 보여준다', async () => {
    mockServer({
      'GET /api/auth/me': notLoggedIn,
      'POST /api/auth/login': jsonResponse(400, { detail: '아이디와 비밀번호를 입력하세요.' }),
    })
    renderApp()
    await userEvent.click(await screen.findByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('아이디와 비밀번호를 입력하세요.')
  })

  it('로그인하면 상담 화면으로 가고, 위쪽에 상담사 이름과 로그아웃이 보인다', async () => {
    mockServer({
      ...baseRoutes(),
      'GET /api/auth/me': notLoggedIn,
      'POST /api/auth/login': { agent },
    })
    renderApp()
    await userEvent.type(await screen.findByLabelText('아이디'), 'kim')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'practice1234')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))

    expect(await screen.findByRole('heading', { name: '문의 #1' })).toBeInTheDocument()
    expect(screen.getByLabelText('로그인한 상담사')).toHaveTextContent('김상담')
    expect(screen.getByRole('button', { name: '로그아웃' })).toBeInTheDocument()
    const menu = within(screen.getByRole('navigation', { name: '메뉴' }))
    expect(menu.getByText('상담')).toBeInTheDocument()
    expect(menu.getByText('작업 기록')).toBeInTheDocument()
    expect(menu.getByText('설정')).toBeInTheDocument()
  })

  it('이미 로그인한 상태로 로그인 화면에 오면 상담 화면으로 보낸다', async () => {
    mockServer(baseRoutes())
    renderApp('/login')
    expect(await screen.findByRole('heading', { name: '문의 #1' })).toBeInTheDocument()
  })

  it('[로그아웃]을 누르면 서버에 알리고 로그인 화면으로 돌아간다', async () => {
    const server = mockServer({ ...baseRoutes(), 'POST /api/auth/logout': jsonResponse(204) })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(screen.getByRole('button', { name: '로그아웃' }))

    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument()
    expect(server.called('POST', '/api/auth/logout')).toHaveLength(1)
  })

  it('일하는 도중 로그인이 풀리면(401) 로그인 화면으로 돌아간다', async () => {
    mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': notLoggedIn,
    })
    renderApp()
    expect(await screen.findByRole('button', { name: '로그인' })).toBeInTheDocument()
  })

  it('서버(backend)가 꺼져 있으면(502, 본문 없음) 로그인 화면에서 바로 알려준다', async () => {
    mockServer({ 'GET /api/auth/me': jsonResponse(502) })
    renderApp()
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결하지 못했습니다. 서버(backend)가 켜져 있는지 확인해 주세요.')
    expect(screen.getByRole('button', { name: '로그인' })).toBeInTheDocument()
  })

  it('단순히 로그인 전(401)이면 연결 오류 안내를 띄우지 않는다', async () => {
    mockServer({ 'GET /api/auth/me': notLoggedIn })
    renderApp()
    await screen.findByRole('button', { name: '로그인' })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('서버에 연결하지 못하면 그 사실을 알려준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/auth/me') return jsonResponse(401, { detail: '로그인이 필요합니다.' })
      throw new TypeError('Failed to fetch')
    }))
    renderApp()
    await userEvent.type(await screen.findByLabelText('아이디'), 'kim')
    await userEvent.type(screen.getByLabelText('비밀번호'), 'x')
    await userEvent.click(screen.getByRole('button', { name: '로그인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('서버에 연결하지 못했습니다')
  })
})

describe('메뉴 이동', () => {
  it('메뉴로 작업 기록과 설정 화면에 갈 수 있다', async () => {
    mockServer({
      ...baseRoutes(makeDetail()),
      'GET /api/action-logs': [],
      'GET /api/settings': { confidence_threshold: 70, min: 50, max: 95 },
      'GET /api/risky-phrases': [],
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(screen.getByRole('link', { name: '작업 기록' }))
    expect(await screen.findByRole('heading', { name: '작업 기록' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: '설정' }))
    expect(await screen.findByRole('heading', { name: '설정' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: '상담' }))
    expect(await screen.findByRole('heading', { name: '문의 #1' })).toBeInTheDocument()
  })
})
