import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi } from 'vitest'
import App from '../App.jsx'

export const FIRST_DRAFT = '안녕하세요, 고객님. 쿠폰은 유효기간이 남아 있으면 되살아납니다. 감사합니다.'
export const SECOND_DRAFT = '안녕하세요, 고객님. (재작성) 유효기간이 지난 쿠폰은 되살릴 수 없습니다. 감사합니다.'

export function jsonResponse(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (data === undefined) throw new Error('본문 없음')
      return data
    },
  }
}

// 서버를 가짜로 대신한다. routes의 키는 "메서드 주소" (예: "POST /api/inquiries/1/approve").
// 값은 데이터, jsonResponse(...), 또는 그것을 돌려주는 함수다. 호출 내역은 calls에 쌓인다.
export function mockServer(routes) {
  const calls = []
  const fetchMock = vi.fn(async (url, options = {}) => {
    const method = options.method ?? 'GET'
    const body = options.body ? JSON.parse(options.body) : undefined
    calls.push({ method, url, body })
    const handler = routes[`${method} ${url}`]
    if (handler === undefined) throw new Error(`가짜 서버에 없는 요청: ${method} ${url}`)
    const result = typeof handler === 'function' ? handler({ body, url }) : handler
    return result && typeof result.json === 'function' ? result : jsonResponse(200, result)
  })
  vi.stubGlobal('fetch', fetchMock)
  return { calls, fetchMock, called: (method, url) => calls.filter((c) => c.method === method && c.url === url) }
}

export const agent = { id: 1, username: 'kim', display_name: '김상담' }

export function makeDraft(draftNo = 1, content = FIRST_DRAFT) {
  return { draft_no: draftNo, content, cited: ['RFD-04'], created_at: '2026-11-02T10:00:00+09:00' }
}

export function makeDetail(overrides = {}) {
  const draft = makeDraft()
  return {
    id: 1,
    body: '쿠폰 쓴 주문을 취소하면 쿠폰은 돌려받나요?',
    status: 'awaiting_approval',
    status_ko: '승인 대기',
    predicted_label: 'buyer_cancel_refund',
    predicted_label_ko: '취소·환불',
    asker: '구매자',
    confidence_percent: 97.9,
    auto_note: null,
    rewrite_count: 0,
    final_reply: null,
    resolved_by_name: null,
    resolved_at: null,
    source: 'seed',
    created_by_name: null,
    version: 0,
    created_at: '2026-11-02T09:00:00+09:00',
    quick_approvable: false,
    drafts: [draft],
    current_draft: draft,
    evidence: [
      {
        id: 'RFD-04',
        title: '취소 시 쿠폰·포인트',
        label: '가상',
        legacy: false,
        content: '- 취소하면 사용한 포인트는 포인트로 돌려준다.\n- 쿠폰은 유효기간이 남아 있으면 되살려 준다.',
      },
    ],
    legacy_only: false,
    risk_warnings: [],
    actions: ['approve', 'edit', 'rewrite'],
    ...overrides,
  }
}

export function makeDone(overrides = {}) {
  return makeDetail({
    status: 'done',
    status_ko: '처리 완료',
    final_reply: FIRST_DRAFT,
    resolved_by_name: '김상담',
    resolved_at: '2026-11-02T10:30:00+09:00',
    version: 1,
    actions: ['reedit'],
    ...overrides,
  })
}

export function makeManual(overrides = {}) {
  return makeDetail({
    id: 2,
    body: '확인 부탁드립니다. 어제 말씀하신 내용이 아직 처리가 안 된 것 같아요.',
    status: 'manual',
    status_ko: '직접 작성',
    predicted_label: 'buyer_delivery',
    predicted_label_ko: '배송',
    confidence_percent: 65.0,
    drafts: [],
    current_draft: null,
    evidence: [],
    actions: ['manual_reply'],
    ...overrides,
  })
}

// 목록에는 자세한 항목 없이 요약만 나온다
export const toListItem = (detail) => {
  const { drafts, current_draft, evidence, legacy_only, risk_warnings, actions, ...item } = detail
  return item
}

// 로그인한 상태의 기본 가짜 서버
export function baseRoutes(detail = makeDetail(), extra = {}) {
  return {
    'GET /api/auth/me': agent,
    'GET /api/inquiries': [toListItem(detail)],
    [`GET /api/inquiries/${detail.id}`]: detail,
    ...extra,
  }
}

// 선택 메뉴(정렬, 상담사, 행동)에서 항목을 고른다: 메뉴를 열고 항목을 누른다
export async function pickOption(name, optionLabel) {
  await userEvent.click(screen.getByRole('combobox', { name }))
  await userEvent.click(screen.getByRole('option', { name: optionLabel }))
}

export function renderApp(path = '/') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  )
}
