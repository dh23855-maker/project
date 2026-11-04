import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent, jsonResponse, makeDetail, makeDone, makeManual, mockServer, renderApp, toListItem } from './utils.jsx'

afterEach(() => vi.unstubAllGlobals())

const item = (id, status, createdAt, body, extra = {}) =>
  toListItem(makeDetail({ id, status, status_ko: status, created_at: createdAt, body, ...extra }))
const order = () =>
  within(screen.getByRole('list', { name: '문의 목록' }))
    .getAllByRole('button')
    .map((b) => b.querySelector('.inquiry-text').textContent)
const tab = (name) => screen.getByRole('tab', { name: new RegExp(`^${name}`) })
const tabText = (name) => tab(name).textContent.replace(/\s+/g, ' ')

// 서버는 최신 문의부터 돌려준다
const MIXED = [
  item(6, 'done', '2026-11-02T13:00:00+09:00', '완료된 최신 문의', { quick_approvable: true }), // 서버는 이런 값을 주지 않지만, 와도 표시하지 않는다
  item(5, 'awaiting_approval', '2026-11-02T12:00:00+09:00', '빠른 승인 가능 A', { quick_approvable: true }),
  item(4, 'awaiting_approval', '2026-11-02T11:30:00+09:00', '확인이 필요한 문의'),
  item(3, 'manual', '2026-11-02T11:00:00+09:00', '직접 작성할 문의'),
  item(2, 'awaiting_approval', '2026-11-02T10:00:00+09:00', '빠른 승인 가능 B', { quick_approvable: true }),
  item(1, 'done', '2026-11-02T09:00:00+09:00', '완료된 오래된 문의'),
]

const chooseQuick = () => userEvent.click(tab('빠른 승인'))

describe('받은 문의의 탭: 전체 / 승인 대기 / 빠른 승인 / 처리 완료', () => {
  const setup = () =>
    mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': MIXED,
      'GET /api/inquiries/5': makeDetail({ id: 5, body: '빠른 승인 가능 A', quick_approvable: true }),
    })

  it('탭은 이 네 개뿐이고 "직접 작성" 탭과 마우스를 올리면 뜨는 메뉴는 없다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #5' })
    expect(screen.getAllByRole('tab').map((t) => t.textContent.replace(/\s+/g, ' '))).toEqual(['전체 6', '승인 대기 4', '빠른 승인 2', '처리 완료 2'])
    expect(screen.queryByRole('tab', { name: /직접 작성/ })).not.toBeInTheDocument()
    await userEvent.hover(tab('승인 대기'))
    await userEvent.hover(tab('빠른 승인'))
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument()
  })

  it('승인 대기 탭에는 직접 작성 상태의 문의도 함께 보인다 (처리할 일을 한 탭에 모음)', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #5' })
    await userEvent.click(tab('승인 대기'))
    expect(order()).toEqual(['빠른 승인 가능 A', '확인이 필요한 문의', '직접 작성할 문의', '빠른 승인 가능 B'])
    expect(tabText('승인 대기')).toBe('승인 대기 4') // 건수에도 포함
    // 목록의 상태 표시는 그대로 "직접 작성"이다
    const manualRow = within(screen.getByRole('list', { name: '문의 목록' })).getByText('직접 작성할 문의').closest('button')
    expect(within(manualRow).getByText('직접 작성')).toBeInTheDocument()
  })

  it('빠른 승인 탭을 누르면 빠른 승인 가능한 문의만 보이고 탭이 선택된다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #5' })
    await chooseQuick()
    expect(order()).toEqual(['빠른 승인 가능 A', '빠른 승인 가능 B'])
    expect(tab('빠른 승인')).toHaveAttribute('aria-selected', 'true')
    expect(tab('승인 대기')).toHaveAttribute('aria-selected', 'false')
    expect(tabText('빠른 승인')).toBe('빠른 승인 2')
    // 보고 있던 문의는 그대로 열려 있다
    expect(screen.getByRole('heading', { name: '문의 #5' })).toBeInTheDocument()
  })

  it('다른 탭으로 옮기면 그 탭의 문의가 보인다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #5' })
    await chooseQuick()
    await userEvent.click(tab('처리 완료'))
    expect(order()).toEqual(['완료된 최신 문의', '완료된 오래된 문의'])
    await userEvent.click(tab('전체'))
    expect(order()).toHaveLength(6)
  })

  it('승인 대기 문의 중 빠른 승인 가능한 것에만 노란 "승인 대기" 옆에 "빠른 승인" 표시가 붙는다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #5' })
    const rows = within(screen.getByRole('list', { name: '문의 목록' })).getAllByRole('button')
    const marked = rows.map((row) => [row.querySelector('.inquiry-text').textContent, row.querySelector('.badge-quick')?.textContent ?? null])
    expect(marked).toEqual([
      ['완료된 최신 문의', null], // 처리 완료에는 붙지 않는다
      ['빠른 승인 가능 A', '빠른 승인'],
      ['확인이 필요한 문의', null],
      ['직접 작성할 문의', null],
      ['빠른 승인 가능 B', '빠른 승인'],
      ['완료된 오래된 문의', null],
    ])
    // "승인 대기" 표시 옆에 나란히 있다
    const badges = rows[1].querySelector('.inquiry-badges')
    expect([...badges.children].map((el) => el.textContent)).toEqual(['승인 대기', '빠른 승인'])
  })

  it('빠른 승인 가능한 문의가 없으면 안내를 보여 주고 [일괄 승인] 버튼은 누를 수 없다', async () => {
    mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': MIXED.map((i) => ({ ...i, quick_approvable: false })),
      'GET /api/inquiries/5': makeDetail({ id: 5 }),
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #5' })
    await chooseQuick()
    expect(screen.getByText('빠른 승인할 수 있는 문의가 없습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '일괄 승인' })).toBeDisabled()
  })
})

describe('일괄 승인: 빠른 승인 탭의 문의 전부를 한 번에 승인', () => {
  // 승인 요청이 가면 그 문의들이 처리 완료로 바뀐 목록을 돌려주는 가짜 서버
  const setup = ({ quickResponse } = {}) => {
    const state = { approved: false }
    const server = mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': () =>
        state.approved
          ? MIXED.map((i) => (i.quick_approvable && i.status === 'awaiting_approval' ? { ...i, status: 'done', quick_approvable: false, version: 1 } : i))
          : MIXED,
      'GET /api/inquiries/5': () =>
        state.approved ? makeDone({ id: 5, body: '빠른 승인 가능 A' }) : makeDetail({ id: 5, body: '빠른 승인 가능 A', quick_approvable: true }),
      'POST /api/inquiries/quick-approve': () => {
        const result = quickResponse ? quickResponse() : { approved: [5, 2], skipped: [] }
        if (!result.status) state.approved = true
        return result
      },
    })
    return { server, state }
  }

  it('[일괄 승인]은 빠른 승인 탭에서만, 문의 목록 오른쪽 위(정렬 옆)에 보인다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #5' })
    expect(screen.queryByRole('button', { name: '일괄 승인' })).not.toBeInTheDocument() // 다른 탭에서는 없다
    await chooseQuick()
    const button = screen.getByRole('button', { name: '일괄 승인' })
    expect(button).toBeEnabled()
    const head = button.closest('.side-head')
    expect(head).toContainElement(screen.getByRole('combobox', { name: '정렬' }))
    expect(head.querySelector('h2').textContent).toBe('받은 문의')
  })

  it('누르면 먼저 확인 창이 뜨고, 취소하면 아무것도 승인하지 않는다', async () => {
    const { server } = setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #5' })
    await chooseQuick()
    await userEvent.click(screen.getByRole('button', { name: '일괄 승인' }))

    const dialog = within(screen.getByRole('dialog', { name: '일괄 승인' }))
    expect(dialog.getByText(/2건/, { selector: 'strong' })).toBeInTheDocument()
    expect(dialog.getByText(/초안 그대로 한 번에 승인/)).toBeInTheDocument()
    expect(dialog.getByText(/실제로 발송되지 않습니다/)).toBeInTheDocument()
    expect(server.called('POST', '/api/inquiries/quick-approve')).toHaveLength(0) // 아직 승인하지 않았다

    await userEvent.click(dialog.getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(server.called('POST', '/api/inquiries/quick-approve')).toHaveLength(0)
  })

  it('"N건 일괄 승인"을 누르면 목록의 문의(번호와 version)를 서버에 보내고, 결과를 보여 준 뒤 목록과 열린 문의를 새로 불러온다', async () => {
    const { server } = setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #5' })
    await chooseQuick()
    await userEvent.click(screen.getByRole('button', { name: '일괄 승인' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '2건 일괄 승인' }))

    expect(await screen.findByText('2건 승인했습니다.')).toBeInTheDocument()
    expect(server.called('POST', '/api/inquiries/quick-approve')[0].body).toEqual({
      items: [
        { id: 5, version: 0 },
        { id: 2, version: 0 },
      ],
    })
    expect(screen.queryByLabelText('건너뛴 문의')).not.toBeInTheDocument()

    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // 승인된 문의는 빠른 승인 목록에서 빠지고, 열려 있던 문의는 처리 완료로 바뀌어 보인다
    expect(screen.getByText('빠른 승인할 수 있는 문의가 없습니다.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '일괄 승인' })).toBeDisabled()
    expect(await within(screen.getByRole('article')).findByRole('button', { name: '다시 수정' })).toBeInTheDocument()
    expect(server.called('GET', '/api/inquiries').length).toBeGreaterThanOrEqual(2)
  })

  it('서버가 건너뛴 문의는 이유와 함께 알려 준다', async () => {
    setup({
      quickResponse: () => ({
        approved: [5],
        skipped: [{ id: 2, reason: '빠른 승인 조건을 더 이상 만족하지 않습니다.' }],
      }),
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #5' })
    await chooseQuick()
    await userEvent.click(screen.getByRole('button', { name: '일괄 승인' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '2건 일괄 승인' }))

    expect(await screen.findByText('1건 승인했습니다.')).toBeInTheDocument()
    expect(screen.getByText('· 1건은 건너뛰었습니다.')).toBeInTheDocument()
    const skipped = within(screen.getByLabelText('건너뛴 문의'))
    expect(skipped.getByText('문의 #2')).toBeInTheDocument()
    expect(skipped.getByText(/빠른 승인 조건을 더 이상 만족하지 않습니다/)).toBeInTheDocument()
  })

  it('승인 요청이 실패하면 확인 창에 이유를 보여 주고 다시 누를 수 있다', async () => {
    let first = true
    setup({
      quickResponse: () => {
        if (first) {
          first = false
          return jsonResponse(500, { detail: '승인하지 못했습니다.' })
        }
        return { approved: [5, 2], skipped: [] }
      },
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #5' })
    await chooseQuick()
    await userEvent.click(screen.getByRole('button', { name: '일괄 승인' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '2건 일괄 승인' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('승인하지 못했습니다.')
    const retry = within(screen.getByRole('dialog')).getByRole('button', { name: '2건 일괄 승인' })
    expect(retry).toBeEnabled()
    await userEvent.click(retry)
    expect(await screen.findByText('2건 승인했습니다.')).toBeInTheDocument()
  })
})

describe('승인하면 다음 문의로 자동 이동', () => {
  // 최신순: 4(승인 대기) → 3(직접 작성) → 2(처리 완료) → 1(승인 대기)
  const LIST = [
    item(4, 'awaiting_approval', '2026-11-02T12:00:00+09:00', 'A 문의'),
    item(3, 'manual', '2026-11-02T11:00:00+09:00', 'B 직접 작성 문의', { predicted_label_ko: '배송' }),
    item(2, 'done', '2026-11-02T10:00:00+09:00', 'C 완료 문의'),
    item(1, 'awaiting_approval', '2026-11-02T09:00:00+09:00', 'D 문의'),
  ]
  const detail = (id, body) => makeDetail({ id, body })
  const done = (id, body) => makeDone({ id, body })

  // changes: 처리하면 그 문의가 처리 완료가 된 목록을 돌려준다
  const setup = (extra = {}) => {
    const finished = new Set()
    const server = mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': () => LIST.map((i) => (finished.has(i.id) ? { ...i, status: 'done', version: 1 } : i)),
      'GET /api/inquiries/4': () => (finished.has(4) ? done(4, 'A 문의') : detail(4, 'A 문의')),
      'GET /api/inquiries/3': () => (finished.has(3) ? done(3, 'B 직접 작성 문의') : makeManual({ id: 3, body: 'B 직접 작성 문의' })),
      'GET /api/inquiries/2': done(2, 'C 완료 문의'),
      'GET /api/inquiries/1': () => (finished.has(1) ? done(1, 'D 문의') : detail(1, 'D 문의')),
      'POST /api/inquiries/4/approve': () => (finished.add(4), done(4, 'A 문의')),
      'POST /api/inquiries/4/edit': () => (finished.add(4), done(4, 'A 문의')),
      'POST /api/inquiries/3/manual-reply': () => (finished.add(3), done(3, 'B 직접 작성 문의')),
      'POST /api/inquiries/1/approve': () => (finished.add(1), done(1, 'D 문의')),
      'POST /api/inquiries/2/edit': done(2, 'C 완료 문의'),
      'POST /api/risk-check': { warnings: [] },
      'GET /api/inquiries/4/similar': { items: [] },
      'GET /api/inquiries/3/similar': { items: [] },
      'GET /api/inquiries/2/similar': { items: [] },
      'GET /api/inquiries/1/similar': { items: [] },
      ...extra,
    })
    return { server, finished }
  }
  const article = () => within(screen.getByRole('article'))

  it('승인하면 목록에서 아래쪽의 아직 처리 안 한 문의(직접 작성 포함)가 바로 열린다', async () => {
    const { server } = setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #4' })
    await userEvent.click(article().getByRole('button', { name: '승인' }))

    expect(await screen.findByRole('heading', { name: '문의 #3' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('승인했습니다. 다음 문의 #3로 이동했습니다.')
    expect(server.called('POST', '/api/inquiries/4/approve')).toHaveLength(1)
    expect(article().getByText('B 직접 작성 문의')).toBeInTheDocument()
  })

  it('직접 작성 답장을 등록하면 처리 완료 문의는 건너뛰고 그다음 처리할 문의로 넘어간다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #4' })
    await userEvent.click(article().getByRole('button', { name: '승인' }))
    await screen.findByRole('heading', { name: '문의 #3' })

    await userEvent.type(screen.getByLabelText('답장 내용'), '직접 쓴 답장입니다.')
    await userEvent.click(article().getByRole('button', { name: '등록' }))
    expect(await screen.findByRole('heading', { name: '문의 #1' })).toBeInTheDocument() // 2번(처리 완료)은 건너뛴다
    expect(screen.getByRole('status')).toHaveTextContent('답장을 등록했습니다. 다음 문의 #1로 이동했습니다.')
  })

  it('수정해서 저장해도(승인 대기 문의) 다음 문의로 넘어간다', async () => {
    const { server } = setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #4' })
    await userEvent.click(article().getByRole('button', { name: '수정' }))
    await userEvent.click(article().getByRole('button', { name: '저장' }))
    expect(await screen.findByRole('heading', { name: '문의 #3' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('고친 답장을 저장했습니다. 다음 문의 #3로 이동했습니다.')
    expect(server.called('POST', '/api/inquiries/4/edit')).toHaveLength(1)
  })

  it('처리 완료 문의의 [다시 수정]은 저장해도 그 문의에 머문다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #4' })
    await userEvent.click(within(screen.getByRole('list', { name: '문의 목록' })).getByRole('button', { name: /C 완료 문의/ }))
    await screen.findByRole('heading', { name: '문의 #2' })
    await userEvent.click(article().getByRole('button', { name: '다시 수정' }))
    await userEvent.click(article().getByRole('button', { name: '저장' }))

    expect(await screen.findByText('고친 답장을 저장했습니다.')).toBeInTheDocument()
    expect(screen.queryByText(/다음 문의/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '문의 #2' })).toBeInTheDocument()
  })

  it('아래에 처리할 문의가 없으면 위쪽에서 가장 가까운 문의로 넘어간다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #4' })
    await userEvent.click(within(screen.getByRole('list', { name: '문의 목록' })).getByRole('button', { name: /D 문의/ }))
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(article().getByRole('button', { name: '승인' }))
    // 위쪽은 2번(처리 완료)을 건너뛰고 3번(직접 작성)
    expect(await screen.findByRole('heading', { name: '문의 #3' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('다음 문의 #3로 이동했습니다.')
  })

  it('처리할 문의가 더 없으면 그 문의에 머물며 처리 결과를 보여 준다', async () => {
    const { finished } = setup()
    finished.add(4).add(3) // 나머지는 이미 처리됨
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' }) // 처음 열 때 승인 대기 문의 #1이 열린다
    await userEvent.click(article().getByRole('button', { name: '승인' }))
    expect(await screen.findByText('승인했습니다.')).toBeInTheDocument()
    expect(screen.queryByText(/다음 문의/)).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '문의 #1' })).toBeInTheDocument()
    expect(await article().findByRole('button', { name: '다시 수정' })).toBeInTheDocument()
  })

  it('승인 대기 탭에서도 목록에서 사라진 문의 다음(아래) 문의가 열린다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #4' })
    await userEvent.click(screen.getByRole('tab', { name: /^승인 대기/ }))
    expect(order()).toEqual(['A 문의', 'B 직접 작성 문의', 'D 문의']) // 직접 작성 상태도 이 탭에 함께 있다
    await userEvent.click(article().getByRole('button', { name: '승인' }))
    expect(await screen.findByRole('heading', { name: '문의 #3' })).toBeInTheDocument() // 바로 아래 문의가 열린다
    expect(order()).toEqual(['B 직접 작성 문의', 'D 문의']) // 승인한 문의는 이 탭에서 빠졌다
  })

  it('승인이 충돌(다른 상담사가 먼저 처리)로 실패하면 넘어가지 않고 최신 상태를 보여 준다', async () => {
    setup({
      'POST /api/inquiries/4/approve': jsonResponse(409, {
        detail: '다른 상담사가 이미 처리했습니다. 최신 상태를 불러왔습니다.',
        inquiry: done(4, 'A 문의'),
      }),
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #4' })
    await userEvent.click(article().getByRole('button', { name: '승인' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('다른 상담사가 이미 처리했습니다.')
    expect(screen.getByRole('heading', { name: '문의 #4' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '문의 #3' })).not.toBeInTheDocument()
  })
})

describe('비슷한 지난 문의', () => {
  const SIMILAR = {
    items: [
      {
        id: 7,
        body: '쿠폰 쓴 주문을 취소했는데 쿠폰은 돌려받나요?',
        predicted_label_ko: '취소·환불',
        final_reply: '쿠폰은 유효기간이 남아 있으면 되살려 드립니다.',
        resolved_at: '2026-11-01T15:20:00+09:00',
        similarity_percent: 62.5,
      },
      {
        id: 8,
        body: '취소하면 포인트는요?',
        predicted_label_ko: '취소·환불',
        final_reply: '포인트는 포인트로 돌려드립니다.',
        resolved_at: '2026-11-01T11:00:00+09:00',
        similarity_percent: 48.1,
      },
    ],
  }
  const similarRequests = (server) => server.called('GET', '/api/inquiries/1/similar')

  it('처음에는 요청하지 않고, [수정]을 눌렀을 때만 비슷한 문의를 찾아 문의·답장과 함께 보여 준다', async () => {
    const server = mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': [toListItem(makeDetail())],
      'GET /api/inquiries/1': makeDetail(),
      'GET /api/inquiries/1/similar': SIMILAR,
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    expect(similarRequests(server)).toHaveLength(0)
    expect(screen.queryByRole('region', { name: '비슷한 지난 문의' })).not.toBeInTheDocument()

    await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '수정' }))
    const region = within(await screen.findByRole('region', { name: '비슷한 지난 문의' }))
    expect(await region.findByText('쿠폰 쓴 주문을 취소했는데 쿠폰은 돌려받나요?')).toBeInTheDocument()
    expect(similarRequests(server)).toHaveLength(1)
    expect(region.getByText(/문의 #7 · 비슷한 정도 62.5%/)).toBeInTheDocument()
    expect(region.getByText('쿠폰은 유효기간이 남아 있으면 되살려 드립니다.')).toBeInTheDocument()
    expect(region.getAllByText('취소·환불')).toHaveLength(2)
    // 가장 비슷한 문의의 답장은 펼쳐져 있고 나머지는 접혀 있다
    const [first, second] = region.getAllByText('최종 답장').map((el) => el.closest('details'))
    expect([first.open, second.open]).toEqual([true, false])
  })

  it('편집을 취소하면 사라진다', async () => {
    mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': [toListItem(makeDetail())],
      'GET /api/inquiries/1': makeDetail(),
      'GET /api/inquiries/1/similar': SIMILAR,
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '수정' }))
    await screen.findByRole('region', { name: '비슷한 지난 문의' })
    await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '취소' }))
    expect(screen.queryByRole('region', { name: '비슷한 지난 문의' })).not.toBeInTheDocument()
  })

  it('찾는 동안에는 "찾는 중..."을 보여 주고, 답장 입력은 바로 할 수 있다', async () => {
    let finish
    mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': [toListItem(makeDetail())],
      'GET /api/inquiries/1': makeDetail(),
      'GET /api/inquiries/1/similar': () => new Promise((resolve) => (finish = () => resolve(SIMILAR))),
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '수정' }))
    const region = within(await screen.findByRole('region', { name: '비슷한 지난 문의' }))
    expect(region.getByText('찾는 중...')).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('답장 내용'), '!') // 기다리지 않고 쓸 수 있다
    finish()
    expect(await region.findByText('쿠폰은 유효기간이 남아 있으면 되살려 드립니다.')).toBeInTheDocument()
  })

  it('비슷한 문의가 없으면 없다고 알려 준다', async () => {
    mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': [toListItem(makeDetail())],
      'GET /api/inquiries/1': makeDetail(),
      'GET /api/inquiries/1/similar': { items: [] },
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '수정' }))
    expect(await screen.findByText('비슷한 지난 문의가 없습니다.')).toBeInTheDocument()
  })

  it('못 불러와도 안내만 하고 답장 쓰기는 막지 않는다', async () => {
    mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': [toListItem(makeDetail())],
      'GET /api/inquiries/1': makeDetail(),
      'GET /api/inquiries/1/similar': jsonResponse(500, { detail: '실패' }),
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '수정' }))
    expect(await screen.findByText(/비슷한 문의를 불러오지 못했습니다/)).toBeInTheDocument()
    expect(screen.getByLabelText('답장 내용')).toBeEnabled()
    expect(screen.getByRole('button', { name: '저장' })).toBeEnabled()
  })

  it('처리 완료 문의의 [다시 수정]에서도 보인다', async () => {
    const server = mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': [toListItem(makeDone())],
      'GET /api/inquiries/1': makeDone(),
      'GET /api/inquiries/1/similar': SIMILAR,
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    expect(similarRequests(server)).toHaveLength(0)
    await userEvent.click(within(screen.getByRole('article')).getByRole('button', { name: '다시 수정' }))
    expect(await screen.findByRole('region', { name: '비슷한 지난 문의' })).toBeInTheDocument()
    expect(similarRequests(server)).toHaveLength(1)
  })

  it('직접 작성 문의는 답장 칸이 처음부터 열려 있으므로 바로 보여 준다', async () => {
    const server = mockServer({
      'GET /api/auth/me': agent,
      'GET /api/inquiries': [toListItem(makeManual())],
      'GET /api/inquiries/2': makeManual(),
      'GET /api/inquiries/2/similar': SIMILAR,
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #2' })
    expect(await screen.findByRole('region', { name: '비슷한 지난 문의' })).toBeInTheDocument()
    expect(server.called('GET', '/api/inquiries/2/similar')).toHaveLength(1)
  })
})
