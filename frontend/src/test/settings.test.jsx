import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent, jsonResponse, mockServer, renderApp } from './utils.jsx'

afterEach(() => vi.unstubAllGlobals())

const phrase = (id, text, by = null) => ({ id, phrase: text, created_at: '2026-11-02T09:00:00+09:00', created_by_name: by })
const settings = (value = 70) => ({ confidence_threshold: value, min: 50, max: 95 })

function routes(extra = {}) {
  return {
    'GET /api/auth/me': agent,
    'GET /api/settings': settings(),
    'GET /api/risky-phrases': [phrase(1, '보상해 드'), phrase(2, '무조건')],
    ...extra,
  }
}

describe('설정 화면: 기준값', () => {
  it('지금 기준값과 허용 범위를 보여준다', async () => {
    mockServer(routes())
    renderApp('/settings')
    expect(await screen.findByLabelText('확신도 기준값 (%)')).toHaveValue('70')
    expect(screen.getByText('50~95 사이의 정수')).toBeInTheDocument()
  })

  it('저장하면 새 값과 "새 문의부터 적용" 안내를 보여준다', async () => {
    const server = mockServer(routes({ 'PUT /api/settings/confidence-threshold': settings(80) }))
    renderApp('/settings')
    const box = await screen.findByLabelText('확신도 기준값 (%)')
    await userEvent.clear(box)
    await userEvent.type(box, '80')
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByRole('status')).toHaveTextContent('기준값을 80%로 저장했습니다. 새로 들어오는 문의부터 적용됩니다.')
    expect(server.called('PUT', '/api/settings/confidence-threshold')[0].body).toEqual({ value: 80 })
  })

  it.each([
    ['49', 49],
    ['96', 96],
    ['70.5', 70.5],
  ])('범위를 벗어나거나 정수가 아닌 값(%s)은 서버의 안내를 그대로 보여준다', async (typed, sent) => {
    const server = mockServer(
      routes({
        'PUT /api/settings/confidence-threshold': jsonResponse(400, { detail: '기준값은 50~95 사이여야 합니다.' }),
      }),
    )
    renderApp('/settings')
    const box = await screen.findByLabelText('확신도 기준값 (%)')
    await userEvent.clear(box)
    await userEvent.type(box, typed)
    await userEvent.click(screen.getByRole('button', { name: '저장' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('기준값은 50~95 사이여야 합니다.')
    expect(server.called('PUT', '/api/settings/confidence-threshold')[0].body).toEqual({ value: sent })
  })

  it('비어 있거나 숫자가 아니면 서버의 안내를 보여준다', async () => {
    const server = mockServer(
      routes({
        'PUT /api/settings/confidence-threshold': jsonResponse(400, { detail: '기준값은 숫자(정수)로 입력하세요.' }),
      }),
    )
    renderApp('/settings')
    const box = await screen.findByLabelText('확신도 기준값 (%)')
    await userEvent.clear(box)
    await userEvent.click(screen.getByRole('button', { name: '저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('기준값은 숫자(정수)로 입력하세요.')
    expect(server.called('PUT', '/api/settings/confidence-threshold')[0].body).toEqual({ value: null })
  })
})

describe('설정 화면: 위험 표현', () => {
  it('목록을 보여주고 추가만 할 수 있다 (삭제 버튼 없음)', async () => {
    mockServer(routes())
    renderApp('/settings')
    expect(await screen.findByText('보상해 드')).toBeInTheDocument()
    expect(screen.getByText('무조건')).toBeInTheDocument()
    expect(screen.getByText('총 2개')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /삭제|지우기/ })).not.toBeInTheDocument()
  })

  it('새 표현을 추가하면 목록이 바뀌고 입력칸이 비워진다', async () => {
    const server = mockServer(
      routes({
        'POST /api/risky-phrases': jsonResponse(201, [phrase(1, '보상해 드'), phrase(2, '무조건'), phrase(3, '특별 지원금', '김상담')]),
      }),
    )
    renderApp('/settings')
    const box = await screen.findByLabelText('새 위험 표현')
    await userEvent.type(box, '특별 지원금')
    await userEvent.click(screen.getByRole('button', { name: '추가' }))

    expect(await screen.findByText('위험 표현을 추가했습니다.')).toBeInTheDocument()
    expect(screen.getByText('특별 지원금')).toBeInTheDocument()
    expect(screen.getByText('총 3개')).toBeInTheDocument()
    expect(box).toHaveValue('')
    expect(server.called('POST', '/api/risky-phrases')[0].body).toEqual({ phrase: '특별 지원금' })
  })

  it('빈 값이나 이미 있는 표현은 서버의 안내를 보여준다', async () => {
    let message = '위험 표현을 입력하세요.'
    mockServer(routes({ 'POST /api/risky-phrases': () => jsonResponse(400, { detail: message }) }))
    renderApp('/settings')
    await screen.findByLabelText('새 위험 표현')

    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('위험 표현을 입력하세요.')

    message = '이미 목록에 있는 표현입니다.'
    await userEvent.type(screen.getByLabelText('새 위험 표현'), '무조건')
    await userEvent.click(screen.getByRole('button', { name: '추가' }))
    expect(await screen.findByText('이미 목록에 있는 표현입니다.')).toBeInTheDocument()
    expect(screen.getByText('총 2개')).toBeInTheDocument()
  })
})
