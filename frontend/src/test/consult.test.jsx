import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FIRST_DRAFT,
  SECOND_DRAFT,
  baseRoutes,
  jsonResponse,
  makeDetail,
  makeDone,
  makeDraft,
  makeManual,
  mockServer,
  renderApp,
  toListItem,
} from './utils.jsx'

afterEach(() => vi.unstubAllGlobals())

const detailArea = () => within(screen.getByRole('article'))
const buttonNames = () => detailArea().queryAllByRole('button').map((b) => b.textContent)

describe('상담 화면: 보기', () => {
  it('문의 목록과 첫 문의의 분류 결과, 초안, 규정 문서를 한 화면에 보여준다', async () => {
    mockServer(baseRoutes())
    renderApp()

    expect(await screen.findByRole('heading', { name: '문의 #1' })).toBeInTheDocument()
    const list = screen.getByRole('list', { name: '문의 목록' })
    expect(within(list).getAllByText('승인 대기')).toHaveLength(2) // 묶음 제목 + 문의 상태
    expect(within(list).getByText(/취소·환불 · 97.9%/)).toBeInTheDocument()

    expect(detailArea().getByText('취소·환불 (확신도 97.9%)')).toBeInTheDocument()
    expect(detailArea().getByText('구매자 문의')).toBeInTheDocument()
    expect(detailArea().getByText(FIRST_DRAFT)).toBeInTheDocument()
    expect(detailArea().getByText(/\[RFD-04\]/)).toBeInTheDocument()
    expect(detailArea().getByText(/취소 시 쿠폰·포인트/)).toBeInTheDocument()
    expect(detailArea().getByText(/쿠폰은 유효기간이 남아 있으면 되살려 준다/)).toBeInTheDocument()
    expect(buttonNames()).toEqual(['승인', '수정', '재작성'])
  })

  it('서버가 알려 준 버튼만 보여준다 (재작성 후에는 직접 작성으로 넘기기)', async () => {
    const second = makeDetail({
      rewrite_count: 1,
      version: 1,
      drafts: [makeDraft(1), makeDraft(2, SECOND_DRAFT)],
      current_draft: makeDraft(2, SECOND_DRAFT),
      actions: ['approve', 'edit', 'handoff'],
    })
    mockServer(baseRoutes(second))
    renderApp()

    await screen.findByRole('heading', { name: '문의 #1' })
    expect(buttonNames()).toEqual(['승인', '수정', '직접 작성으로 넘기기'])
    expect(detailArea().getByRole('heading', { name: '답장 초안 (재작성한 초안)' })).toBeInTheDocument()
    expect(detailArea().getByText(SECOND_DRAFT)).toBeInTheDocument()
    expect(detailArea().getByText('첫 번째 초안 보기')).toBeInTheDocument()
  })

  it('근거가 구버전뿐이면 구버전 기준 경고를 보여준다', async () => {
    const legacy = makeDetail({
      legacy_only: true,
      evidence: [{ id: 'PKG-01', title: '박스 외관', label: '구버전', legacy: true, content: '찌그러짐 30% 이상' }],
    })
    mockServer(baseRoutes(legacy))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    expect(detailArea().getByText('구버전 기준이라 현재와 다를 수 있음')).toBeInTheDocument()
  })

  it('현행 근거에는 구버전 경고가 없다', async () => {
    mockServer(baseRoutes())
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    expect(screen.queryByText('구버전 기준이라 현재와 다를 수 있음')).not.toBeInTheDocument()
  })

  it('초안에 위험 표현이 있으면 경고와 해당 문장을 보여주지만 승인은 막지 않는다', async () => {
    const risky = makeDetail({
      risk_warnings: [{ sentence: '전액 보상해 드리겠습니다.', phrases: ['보상해 드', '전액 보상'] }],
    })
    mockServer(baseRoutes(risky))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    expect(detailArea().getByText('위험 표현 경고')).toBeInTheDocument()
    expect(detailArea().getByText('전액 보상해 드리겠습니다.')).toBeInTheDocument()
    expect(detailArea().getByRole('button', { name: '승인' })).toBeEnabled()
  })

  it('직접 작성 문의는 이유 안내와 답장 칸을 보여준다', async () => {
    const manual = makeManual({ auto_note: '정책에서 근거를 찾지 못해 직접 작성으로 넘어갔습니다.' })
    mockServer(baseRoutes(manual))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #2' })
    expect(detailArea().getByText('정책에서 근거를 찾지 못해 직접 작성으로 넘어갔습니다.')).toBeInTheDocument()
    expect(detailArea().getByLabelText('답장 내용')).toBeInTheDocument()
    expect(buttonNames()).toEqual(['등록'])
  })

  it('분류에 실패한 문의는 분류 결과 없음으로 보여준다', async () => {
    const failed = makeManual({
      predicted_label: null,
      predicted_label_ko: null,
      asker: null,
      confidence_percent: null,
      auto_note: '자동 처리에 실패해 직접 작성으로 넘어갔습니다.',
    })
    mockServer(baseRoutes(failed))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #2' })
    expect(detailArea().getByText('분류 결과 없음')).toBeInTheDocument()
  })

  it('처음 열면 목록 맨 위가 직접 작성이어도 승인 대기 문의를 먼저 연다', async () => {
    const manual = makeManual({ id: 9 })
    const awaiting = makeDetail({ id: 3 })
    mockServer({
      'GET /api/auth/me': { id: 1, username: 'kim', display_name: '김상담' },
      'GET /api/inquiries': [toListItem(manual), toListItem(awaiting)],
      'GET /api/inquiries/3': awaiting,
      'GET /api/inquiries/9': manual,
    })
    renderApp()
    expect(await screen.findByRole('heading', { name: '문의 #3' })).toBeInTheDocument()
  })

  it('승인 대기가 하나도 없으면 맨 위 문의를 연다', async () => {
    const manual = makeManual({ id: 9 })
    mockServer({
      'GET /api/auth/me': { id: 1, username: 'kim', display_name: '김상담' },
      'GET /api/inquiries': [toListItem(manual)],
      'GET /api/inquiries/9': manual,
    })
    renderApp()
    expect(await screen.findByRole('heading', { name: '문의 #9' })).toBeInTheDocument()
  })

  it('문의가 하나도 없으면 안내한다', async () => {
    mockServer({ 'GET /api/auth/me': { id: 1, username: 'kim', display_name: '김상담' }, 'GET /api/inquiries': [] })
    renderApp()
    expect(await screen.findByText('문의가 없습니다.')).toBeInTheDocument()
  })

  it('목록에서 다른 문의를 누르면 그 문의를 연다', async () => {
    const first = makeDetail()
    const second = makeManual()
    mockServer({
      'GET /api/auth/me': { id: 1, username: 'kim', display_name: '김상담' },
      'GET /api/inquiries': [toListItem(first), toListItem(second)],
      'GET /api/inquiries/1': first,
      'GET /api/inquiries/2': second,
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(within(screen.getByRole('list', { name: '문의 목록' })).getByText(/확인 부탁드립니다/))
    expect(await screen.findByRole('heading', { name: '문의 #2' })).toBeInTheDocument()
  })
})

describe('상담 화면: 승인', () => {
  it('[승인]을 누르면 화면에서 본 version으로 요청하고 처리 완료로 바뀐다', async () => {
    const done = makeDone()
    const server = mockServer(
      baseRoutes(makeDetail(), { 'POST /api/inquiries/1/approve': done }),
    )
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(detailArea().getByRole('button', { name: '승인' }))

    expect(await screen.findByText('승인했습니다.')).toBeInTheDocument()
    expect(server.called('POST', '/api/inquiries/1/approve')[0].body).toEqual({ version: 0 })
    expect(detailArea().getByText('처리 완료')).toBeInTheDocument()
    expect(detailArea().getByText(/처리: 김상담/)).toBeInTheDocument()
    expect(buttonNames()).toEqual(['다시 수정'])
  })

  it('처리하는 동안 버튼을 잠그고 진행 안내를 보여준다', async () => {
    let finish
    mockServer(
      baseRoutes(makeDetail(), {
        'POST /api/inquiries/1/approve': () =>
          new Promise((resolve) => {
            finish = () => resolve(jsonResponse(200, makeDone()))
          }),
      }),
    )
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(detailArea().getByRole('button', { name: '승인' }))

    expect(await screen.findByRole('status')).toHaveTextContent('승인하는 중...')
    expect(detailArea().getByRole('button', { name: '승인' })).toBeDisabled()
    expect(detailArea().getByRole('button', { name: '재작성' })).toBeDisabled()
    finish()
    await screen.findByText('승인했습니다.')
  })

  it('다른 상담사가 먼저 처리했으면 안내하고 최신 상태로 바꾼다', async () => {
    const latest = makeDone({ resolved_by_name: '박상담' })
    mockServer(
      baseRoutes(makeDetail(), {
        'POST /api/inquiries/1/approve': jsonResponse(409, {
          detail: '다른 상담사가 이미 처리했습니다. 최신 상태를 불러왔습니다.',
          inquiry: latest,
        }),
      }),
    )
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(detailArea().getByRole('button', { name: '승인' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('다른 상담사가 이미 처리했습니다')
    expect(detailArea().getByText(/처리: 박상담/)).toBeInTheDocument()
    expect(buttonNames()).toEqual(['다시 수정'])
  })
})

describe('상담 화면: 수정', () => {
  async function openEditor() {
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(detailArea().getByRole('button', { name: '수정' }))
    const box = detailArea().getByLabelText('답장 내용')
    expect(box).toHaveValue(FIRST_DRAFT)
    return box
  }

  it('위험 표현이 없으면 바로 저장되고 수정하여 처리 완료가 된다', async () => {
    const edited = makeDone({ final_reply: '고친 답장입니다.' })
    const server = mockServer(
      baseRoutes(makeDetail(), {
        'POST /api/risk-check': { warnings: [] },
        'POST /api/inquiries/1/edit': edited,
      }),
    )
    renderApp()
    const box = await openEditor()
    await userEvent.clear(box)
    await userEvent.type(box, '고친 답장입니다.')
    await userEvent.click(detailArea().getByRole('button', { name: '저장' }))

    expect(await screen.findByText('고친 답장을 저장했습니다.')).toBeInTheDocument()
    expect(server.called('POST', '/api/inquiries/1/edit')[0].body).toEqual({ version: 0, text: '고친 답장입니다.' })
    expect(detailArea().getByText('고친 답장입니다.')).toBeInTheDocument()
  })

  it('저장 전에 위험 표현을 보여주고, 상담사가 확인해야 저장한다 (막지는 않음)', async () => {
    const edited = makeDone({ final_reply: '전액 보상해 드릴게요.' })
    const server = mockServer(
      baseRoutes(makeDetail(), {
        'POST /api/risk-check': {
          warnings: [{ sentence: '전액 보상해 드릴게요.', phrases: ['보상해 드', '전액 보상'] }],
        },
        'POST /api/inquiries/1/edit': edited,
      }),
    )
    renderApp()
    const box = await openEditor()
    await userEvent.clear(box)
    await userEvent.type(box, '전액 보상해 드릴게요.')
    await userEvent.click(detailArea().getByRole('button', { name: '저장' }))

    expect(await detailArea().findByText('위험 표현 경고')).toBeInTheDocument()
    expect(detailArea().getByText('전액 보상해 드릴게요.', { selector: 'mark' })).toBeInTheDocument()
    expect(server.called('POST', '/api/inquiries/1/edit')).toHaveLength(0) // 아직 저장 전

    await userEvent.click(detailArea().getByRole('button', { name: '그래도 저장' }))
    await screen.findByText('고친 답장을 저장했습니다.')
    expect(server.called('POST', '/api/inquiries/1/edit')).toHaveLength(1)
  })

  it('경고를 보고 [계속 고치기]를 누르면 저장하지 않고 편집으로 돌아간다', async () => {
    const server = mockServer(
      baseRoutes(makeDetail(), {
        'POST /api/risk-check': { warnings: [{ sentence: '무조건 됩니다.', phrases: ['무조건'] }] },
      }),
    )
    renderApp()
    const box = await openEditor()
    await userEvent.clear(box)
    await userEvent.type(box, '무조건 됩니다.')
    await userEvent.click(detailArea().getByRole('button', { name: '저장' }))
    await detailArea().findByText('위험 표현 경고')
    await userEvent.click(detailArea().getByRole('button', { name: '계속 고치기' }))

    expect(detailArea().queryByText('위험 표현 경고')).not.toBeInTheDocument()
    expect(detailArea().getByRole('button', { name: '저장' })).toBeInTheDocument()
    expect(server.called('POST', '/api/inquiries/1/edit')).toHaveLength(0)
  })

  it('빈 답장은 서버에 보내지 않고 안내한다', async () => {
    const server = mockServer(baseRoutes())
    renderApp()
    const box = await openEditor()
    await userEvent.clear(box)
    await userEvent.click(detailArea().getByRole('button', { name: '저장' }))

    expect(await detailArea().findByRole('alert')).toHaveTextContent('답장 내용을 입력하세요.')
    expect(server.called('POST', '/api/risk-check')).toHaveLength(0)
  })

  it('[취소]를 누르면 고치던 내용을 버리고 초안으로 돌아간다', async () => {
    mockServer(baseRoutes())
    renderApp()
    const box = await openEditor()
    await userEvent.type(box, ' 덧붙임')
    await userEvent.click(detailArea().getByRole('button', { name: '취소' }))
    expect(detailArea().getByText(FIRST_DRAFT)).toBeInTheDocument()
    expect(buttonNames()).toEqual(['승인', '수정', '재작성'])
  })

  it('처리 완료 문의를 [다시 수정]으로 고치면 처리 완료 그대로 최종 답장만 바뀐다', async () => {
    const again = makeDone({ final_reply: '다시 고친 답장', version: 2 })
    const server = mockServer(
      baseRoutes(makeDone(), {
        'POST /api/risk-check': { warnings: [] },
        'POST /api/inquiries/1/edit': again,
      }),
    )
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(detailArea().getByRole('button', { name: '다시 수정' }))
    const box = detailArea().getByLabelText('답장 내용')
    await userEvent.clear(box)
    await userEvent.type(box, '다시 고친 답장')
    await userEvent.click(detailArea().getByRole('button', { name: '저장' }))

    await screen.findByText('고친 답장을 저장했습니다.')
    expect(server.called('POST', '/api/inquiries/1/edit')[0].body).toEqual({ version: 1, text: '다시 고친 답장' })
    expect(detailArea().getByText('처리 완료')).toBeInTheDocument()
    expect(detailArea().getByText('다시 고친 답장')).toBeInTheDocument()
  })
})

describe('상담 화면: 재작성과 직접 작성', () => {
  it('[재작성]을 누르면 새 초안이 나오고 재작성 버튼은 사라진다', async () => {
    const second = makeDetail({
      rewrite_count: 1,
      version: 1,
      drafts: [makeDraft(1), makeDraft(2, SECOND_DRAFT)],
      current_draft: makeDraft(2, SECOND_DRAFT),
      actions: ['approve', 'edit', 'handoff'],
    })
    mockServer(baseRoutes(makeDetail(), { 'POST /api/inquiries/1/rewrite': second }))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(detailArea().getByRole('button', { name: '재작성' }))

    expect(await detailArea().findByText(SECOND_DRAFT)).toBeInTheDocument()
    expect(buttonNames()).toEqual(['승인', '수정', '직접 작성으로 넘기기'])
    expect(screen.getByText('새 초안을 만들었습니다.')).toBeInTheDocument()
  })

  it('재작성에 실패하면 안내하고 첫 초안과 [재작성] 버튼을 그대로 둔다', async () => {
    mockServer(
      baseRoutes(makeDetail(), {
        'POST /api/inquiries/1/rewrite': jsonResponse(502, {
          detail: '새 초안을 만들지 못했습니다. 첫 번째 초안은 그대로 두었으니 다시 눌러 주세요.',
        }),
      }),
    )
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(detailArea().getByRole('button', { name: '재작성' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('새 초안을 만들지 못했습니다')
    expect(detailArea().getByText(FIRST_DRAFT)).toBeInTheDocument()
    expect(buttonNames()).toEqual(['승인', '수정', '재작성'])
  })

  it('[직접 작성으로 넘기기]를 누르면 직접 작성 상태가 된다', async () => {
    const second = makeDetail({
      rewrite_count: 1,
      version: 1,
      drafts: [makeDraft(1), makeDraft(2, SECOND_DRAFT)],
      current_draft: makeDraft(2, SECOND_DRAFT),
      actions: ['approve', 'edit', 'handoff'],
    })
    const manual = makeManual({ id: 1, body: second.body, version: 2 })
    const server = mockServer(baseRoutes(second, { 'POST /api/inquiries/1/handoff': manual }))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(detailArea().getByRole('button', { name: '직접 작성으로 넘기기' }))

    await screen.findByText('직접 작성으로 넘겼습니다.')
    expect(server.called('POST', '/api/inquiries/1/handoff')[0].body).toEqual({ version: 1 })
    expect(detailArea().getByLabelText('답장 내용')).toBeInTheDocument()
    expect(buttonNames()).toEqual(['등록'])
  })

  it('직접 작성: 빈 답장은 막고, 쓴 답장은 위험 표현 검사 후 등록한다', async () => {
    const manual = makeManual()
    const done = makeDone({ id: 2, body: manual.body, final_reply: '직접 쓴 답장입니다.' })
    const server = mockServer(
      baseRoutes(manual, {
        'POST /api/risk-check': { warnings: [] },
        'POST /api/inquiries/2/manual-reply': done,
      }),
    )
    renderApp()
    await screen.findByRole('heading', { name: '문의 #2' })

    await userEvent.click(detailArea().getByRole('button', { name: '등록' }))
    expect(await detailArea().findByRole('alert')).toHaveTextContent('답장 내용을 입력하세요.')
    expect(server.called('POST', '/api/inquiries/2/manual-reply')).toHaveLength(0)

    await userEvent.type(detailArea().getByLabelText('답장 내용'), '직접 쓴 답장입니다.')
    await userEvent.click(detailArea().getByRole('button', { name: '등록' }))
    await screen.findByText('답장을 등록했습니다.')
    expect(server.called('POST', '/api/inquiries/2/manual-reply')[0].body).toEqual({
      version: 0,
      text: '직접 쓴 답장입니다.',
    })
    expect(detailArea().getByText('직접 쓴 답장입니다.')).toBeInTheDocument()
  })
})

describe('상담 화면: 새 문의 입력', () => {
  const created = makeDetail({ id: 7, body: '새로 입력한 문의입니다.' })

  it('등록하면 목록에 나타나고 그 문의가 열린다', async () => {
    const list = [toListItem(makeDetail())]
    const server = mockServer({
      'GET /api/auth/me': { id: 1, username: 'kim', display_name: '김상담' },
      'GET /api/inquiries': () => list,
      'GET /api/inquiries/1': makeDetail(),
      'GET /api/inquiries/7': created,
      'POST /api/inquiries': () => {
        list.unshift(toListItem(created))
        return jsonResponse(201, created)
      },
    })
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.type(screen.getByLabelText('새 문의 입력'), '새로 입력한 문의입니다.')
    await userEvent.click(screen.getByRole('button', { name: '등록' }))

    expect(await screen.findByRole('heading', { name: '문의 #7' })).toBeInTheDocument()
    expect(server.called('POST', '/api/inquiries')[0].body).toEqual({ body: '새로 입력한 문의입니다.' })
    expect(server.called('GET', '/api/inquiries/7')).toHaveLength(0) // 이미 받은 내용을 다시 불러오지 않는다
    expect(within(screen.getByRole('list', { name: '문의 목록' })).getByText(/새로 입력한 문의입니다/)).toBeInTheDocument()
    expect(screen.getByLabelText('새 문의 입력')).toHaveValue('')
  })

  it('1,000자를 넘으면 서버의 글자 수 안내를 그대로 보여준다', async () => {
    mockServer(
      baseRoutes(makeDetail(), {
        'POST /api/inquiries': jsonResponse(400, { detail: '문의 내용은 1000자까지 입력할 수 있습니다. 지금은 1001자입니다.' }),
      }),
    )
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    const box = screen.getByLabelText('새 문의 입력')
    await userEvent.click(box)
    await userEvent.paste('가'.repeat(1001))
    expect(screen.getByText('1001 / 1000')).toHaveClass('over')
    await userEvent.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('문의 내용은 1000자까지 입력할 수 있습니다. 지금은 1001자입니다.')).toBeInTheDocument()
  })

  it('빈 문의는 서버에 보내지 않고 안내한다', async () => {
    const server = mockServer(baseRoutes())
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    await userEvent.click(screen.getByRole('button', { name: '등록' }))
    expect(await screen.findByText('문의 내용을 입력하세요.')).toBeInTheDocument()
    expect(server.called('POST', '/api/inquiries')).toHaveLength(0)
  })
})

describe('받은편지함 정렬', () => {
  const item = (id, status, createdAt, body) =>
    toListItem(makeDetail({ id, status, status_ko: status, created_at: createdAt, body }))
  // 서버는 최신 문의부터 돌려준다
  const mixed = [
    item(5, 'done', '2026-11-02T13:00:00+09:00', '완료된 최신 문의'),
    item(4, 'awaiting_approval', '2026-11-02T12:00:00+09:00', '대기 중 나중에 온 문의'),
    item(3, 'manual', '2026-11-02T11:00:00+09:00', '직접 작성할 문의'),
    item(2, 'awaiting_approval', '2026-11-02T10:00:00+09:00', '대기 중 먼저 온 문의'),
    item(1, 'done', '2026-11-02T09:00:00+09:00', '완료된 오래된 문의'),
  ]
  const setup = () =>
    mockServer({
      'GET /api/auth/me': { id: 1, username: 'kim', display_name: '김상담' },
      'GET /api/inquiries': mixed,
      'GET /api/inquiries/4': makeDetail({ id: 4 }),
    })
  const order = () =>
    within(screen.getByRole('list', { name: '문의 목록' }))
      .getAllByRole('button')
      .map((b) => b.querySelector('.inquiry-text').textContent)

  it('처음에는 상태별로 모아 보여 주고, 묶음마다 제목과 건수가 있다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #4' })
    expect(order()).toEqual([
      '대기 중 나중에 온 문의',
      '대기 중 먼저 온 문의',
      '직접 작성할 문의',
      '완료된 최신 문의',
      '완료된 오래된 문의',
    ])
    const heads = Array.from(document.querySelectorAll('.group-head')).map((el) => el.textContent)
    expect(heads).toEqual(['승인 대기 2건', '직접 작성 1건', '처리 완료 2건'])
    expect(screen.getByLabelText('정렬')).toHaveValue('status')
  })

  it('최신순과 오래된순으로 바꾸면 묶음 제목 없이 날짜순으로 보여 준다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #4' })

    await userEvent.selectOptions(screen.getByLabelText('정렬'), 'newest')
    expect(order()).toEqual([
      '완료된 최신 문의',
      '대기 중 나중에 온 문의',
      '직접 작성할 문의',
      '대기 중 먼저 온 문의',
      '완료된 오래된 문의',
    ])
    expect(document.querySelectorAll('.group-head')).toHaveLength(0)

    await userEvent.selectOptions(screen.getByLabelText('정렬'), 'oldest')
    expect(order()).toEqual([
      '완료된 오래된 문의',
      '대기 중 먼저 온 문의',
      '직접 작성할 문의',
      '대기 중 나중에 온 문의',
      '완료된 최신 문의',
    ])
  })

  it('정렬을 바꿔도 보고 있던 문의는 그대로 선택되어 있다', async () => {
    setup()
    renderApp()
    await screen.findByRole('heading', { name: '문의 #4' })
    await userEvent.selectOptions(screen.getByLabelText('정렬'), 'oldest')
    expect(screen.getByRole('heading', { name: '문의 #4' })).toBeInTheDocument()
    const selected = within(screen.getByRole('list', { name: '문의 목록' })).getByText('대기 중 나중에 온 문의')
    expect(selected.closest('button')).toHaveAttribute('aria-current', 'true')
  })
})

describe('규정 문서에는 없음', () => {
  it('규정 문서가 하나도 없는 초안은 "규정 문서에는 없음"과 이유를 보여 준다', async () => {
    const draft = { ...makeDraft(), cited: [], uncovered_note: '이 문의에 해당하는 내용이 규정 문서에는 없습니다.' }
    mockServer(baseRoutes(makeDetail({ drafts: [draft], current_draft: draft, evidence: [] })))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })

    const section = within(screen.getByRole('region', { name: '규정 문서' }))
    expect(section.getByText('규정 문서에는 없음')).toBeInTheDocument()
    expect(section.getByText('이 문의에 해당하는 내용이 규정 문서에는 없습니다.')).toBeInTheDocument()
    expect(section.queryByText(/\[RFD-04\]/)).not.toBeInTheDocument()
    expect(detailArea().getByText(FIRST_DRAFT)).toBeInTheDocument() // 초안은 그대로 보인다
    expect(buttonNames()).toEqual(['승인', '수정', '재작성'])
  })

  it('일부만 근거가 있으면 규정 문서와 함께 없는 내용을 보여 준다', async () => {
    const draft = { ...makeDraft(), uncovered_note: '입금 예정일은 규정 문서에 없습니다.' }
    mockServer(baseRoutes(makeDetail({ drafts: [draft], current_draft: draft })))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })

    const section = within(screen.getByRole('region', { name: '규정 문서' }))
    expect(section.getByText(/\[RFD-04\]/)).toBeInTheDocument()
    expect(section.getByText('규정 문서에는 없음')).toBeInTheDocument()
    expect(section.getByText('입금 예정일은 규정 문서에 없습니다.')).toBeInTheDocument()
  })

  it('규정 문서 안에서 모두 답한 초안에는 "규정 문서에는 없음"이 나오지 않는다', async () => {
    mockServer(baseRoutes())
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    expect(screen.queryByText('규정 문서에는 없음')).not.toBeInTheDocument()
  })

  it('확신도가 낮아도 초안이 나오고, 분류 경고 문구가 함께 보인다', async () => {
    const note = '분류 확신도가 기준값(70%)보다 낮습니다. 문의 종류가 맞는지 먼저 확인해 주세요.'
    mockServer(baseRoutes(makeDetail({ confidence_percent: 41.2, auto_note: note })))
    renderApp()
    await screen.findByRole('heading', { name: '문의 #1' })
    expect(detailArea().getByText(note)).toBeInTheDocument()
    expect(detailArea().getByText(FIRST_DRAFT)).toBeInTheDocument()
    expect(buttonNames()).toEqual(['승인', '수정', '재작성'])
  })
})
