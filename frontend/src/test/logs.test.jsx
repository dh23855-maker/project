import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent, mockServer, pickOption, renderApp } from './utils.jsx'

afterEach(() => vi.unstubAllGlobals())

const row = (overrides = {}) => ({
  id: 1,
  created_at: '2026-11-02T10:30:00+09:00',
  action: 'approve',
  action_ko: '승인',
  inquiry_id: 5,
  inquiry_body: '쿠폰 쓴 주문을 취소하면 쿠폰은 돌려받나요?',
  agent_username: 'kim',
  agent_name: '김상담',
  draft_text: '초안 내용입니다.',
  new_draft_text: null,
  final_reply: '초안 내용입니다.',
  ...overrides,
})

function routes(rowsFor) {
  return {
    'GET /api/auth/me': agent,
    'GET /api/action-logs': () => rowsFor(''),
    'GET /api/action-logs?agent=park': () => rowsFor('agent=park'),
    'GET /api/action-logs?action=edit': () => rowsFor('action=edit'),
    'GET /api/action-logs?agent=park&action=edit': () => rowsFor('agent=park&action=edit'),
  }
}

describe('작업 기록 화면', () => {
  it('누가, 언제, 무엇을 했는지 목록으로 보여준다', async () => {
    mockServer(
      routes(() => [
        row(),
        row({ id: 2, action: 'edit', action_ko: '수정', agent_name: '박상담', agent_username: 'park' }),
      ]),
    )
    renderApp('/logs')
    const table = await screen.findByRole('table')
    expect(within(table).getByText('김상담')).toBeInTheDocument()
    expect(within(table).getByText('박상담')).toBeInTheDocument()
    expect(within(table).getByText('승인')).toBeInTheDocument()
    expect(within(table).getByText('수정')).toBeInTheDocument()
    expect(within(table).getAllByText(/#5 쿠폰 쓴 주문을 취소하면/)).toHaveLength(2)
  })

  it('[자세히]를 누르면 초안과 최종 답장을, 재작성은 이전 초안과 새 초안을 보여준다', async () => {
    mockServer(
      routes(() => [
        row({ id: 1, final_reply: '최종 답장 본문' }),
        row({ id: 2, action: 'rewrite', action_ko: '재작성', draft_text: '처음에 쓴 초안 본문', new_draft_text: '다시 쓴 초안 본문', final_reply: null }),
      ]),
    )
    renderApp('/logs')
    await screen.findByRole('table')
    const buttons = screen.getAllByRole('button', { name: '자세히' })

    await userEvent.click(buttons[0])
    expect(screen.getByText('최종 답장 본문')).toBeInTheDocument()

    await userEvent.click(buttons[1])
    expect(screen.getByText('재작성 전 초안')).toBeInTheDocument() // 소제목
    expect(screen.getByText('처음에 쓴 초안 본문')).toBeInTheDocument()
    expect(screen.getByText('새 초안')).toBeInTheDocument() // 소제목
    expect(screen.getByText('다시 쓴 초안 본문')).toBeInTheDocument()
  })

  it('[자세히]의 초안, 새 초안, 최종 답장은 각각 따로 둥근 상자에 담겨 구분된다', async () => {
    mockServer(
      routes(() => [
        row({ id: 1, draft_text: '초안 본문', final_reply: '최종 답장 본문' }),
        row({ id: 2, action: 'rewrite', action_ko: '재작성', draft_text: '처음 초안', new_draft_text: '새 초안 본문', final_reply: null }),
      ]),
    )
    renderApp('/logs')
    await screen.findByRole('table')
    const buttons = screen.getAllByRole('button', { name: '자세히' })

    await userEvent.click(buttons[0])
    const blocks = () => [...document.querySelectorAll('.log-detail .log-block')]
    expect(blocks().map((b) => b.className.replace('log-block ', ''))).toEqual(['log-block-draft', 'log-block-final'])
    expect(blocks()[0]).toHaveTextContent('초안초안 본문')
    expect(blocks()[1]).toHaveTextContent('최종 답장최종 답장 본문')

    await userEvent.click(buttons[1])
    expect(blocks().map((b) => b.className.replace('log-block ', ''))).toEqual(['log-block-draft', 'log-block-new']) // 다른 행을 열면 앞의 행은 닫힌다
    expect(blocks()[1]).toHaveTextContent('새 초안새 초안 본문')
  })

  it('머리글 "행동"에는 뱃지와 열을 맞추는 표시(col-action)가 있다', async () => {
    mockServer(routes(() => [row()]))
    renderApp('/logs')
    await screen.findByRole('table')
    expect(screen.getByRole('columnheader', { name: '행동' })).toHaveClass('col-action')
    const css = readFileSync(join(process.cwd(), 'src', 'styles.css'), 'utf-8')
    const tagMargin = Number(css.match(/\.tag \{\s*margin-left: (\d+)px/)[1])
    const headerPad = Number(css.match(/\.table th\.col-action \{\s*padding-left: (\d+)px/)[1])
    const cellPad = Number(css.match(/\.table th,\s*\.table td \{\s*padding: \d+px (\d+)px/)[1])
    expect(headerPad).toBe(cellPad + tagMargin) // 뱃지의 왼쪽 위치와 같다
  })

  it('상담사와 행동으로 거르면 그 조건으로 다시 불러온다', async () => {
    const server = mockServer(routes(() => [row()]))
    renderApp('/logs')
    await screen.findByRole('table')

    await pickOption('상담사', '박상담')
    await waitFor(() => expect(server.called('GET', '/api/action-logs?agent=park')).toHaveLength(1))

    await pickOption('행동', '수정')
    await waitFor(() => expect(server.called('GET', '/api/action-logs?agent=park&action=edit')).toHaveLength(1))

    await pickOption('상담사', '전체')
    await waitFor(() => expect(server.called('GET', '/api/action-logs?action=edit')).toHaveLength(1))
  })

  it('조건에 맞는 기록이 없으면 안내한다', async () => {
    mockServer(routes(() => []))
    renderApp('/logs')
    expect(await screen.findByText('기록이 없습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('불러오지 못하면 오류를 보여준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/auth/me') return { ok: true, status: 200, json: async () => agent }
      return { ok: false, status: 500, json: async () => ({ detail: '서버 오류' }) }
    }))
    renderApp('/logs')
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 오류')
  })
})
