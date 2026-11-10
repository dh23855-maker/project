// 서버(/api)와 주고받는 모든 요청을 여기서 한다.
// 실패하면 ApiError를 던진다. message는 화면에 그대로 보여줄 수 있는 한국어 안내다.

export class ApiError extends Error {
  constructor(status, message, inquiry = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.inquiry = inquiry // 동시 처리 충돌(409)일 때 서버가 돌려주는 최신 문의 상태
  }
}

const GENERIC_ERROR = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.'
// 서버(backend)가 꺼져 있으면 화면 서버가 본문 없는 5xx(502 등)를 돌려준다
const NO_SERVER_ERROR = '서버에 연결하지 못했습니다. 서버(backend)가 켜져 있는지 확인해 주세요.'

// 화면과 서버가 다른 주소일 때(배포) VITE_API_BASE에 서버 주소를 넣는다. 비워 두면 같은 주소(/api)로 보낸다.
const API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')

let onUnauthorized = null
// 로그인이 풀렸을 때(401) 화면을 로그인으로 돌려보내기 위한 연결
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler
}

function messageFrom(data) {
  if (data && typeof data.detail === 'string') return data.detail
  return GENERIC_ERROR // 서버가 형식 오류(422 목록 등)를 돌려준 경우
}

async function request(method, path, body, { quiet401 = false } = {}) {
  let response
  try {
    response = await fetch(API_BASE + path, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: API_BASE ? 'include' : 'same-origin', // 다른 주소의 서버에도 로그인 쿠키를 보낸다
    })
  } catch {
    throw new ApiError(0, NO_SERVER_ERROR)
  }

  if (response.status === 204) return null
  let data = null
  try {
    data = await response.json()
  } catch {
    data = null
  }

  if (!response.ok) {
    if (response.status === 401 && !quiet401 && onUnauthorized) onUnauthorized()
    const noServer = response.status >= 500 && data === null
    throw new ApiError(response.status, noServer ? NO_SERVER_ERROR : messageFrom(data), data?.inquiry ?? null)
  }
  return data
}

const query = (params) => {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value) search.set(key, value)
  })
  const text = search.toString()
  return text ? `?${text}` : ''
}

export const api = {
  // 로그인
  login: (username, password) => request('POST', '/api/auth/login', { username, password }, { quiet401: true }),
  logout: () => request('POST', '/api/auth/logout'),
  me: () => request('GET', '/api/auth/me', undefined, { quiet401: true }),

  // 문의
  listInquiries: () => request('GET', '/api/inquiries'),
  getInquiry: (id) => request('GET', `/api/inquiries/${id}`),
  createInquiry: (body) => request('POST', '/api/inquiries', { body }),

  // 승인 흐름 (version: 상담사가 화면에서 본 문의의 version)
  approve: (id, version) => request('POST', `/api/inquiries/${id}/approve`, { version }),
  edit: (id, version, text) => request('POST', `/api/inquiries/${id}/edit`, { version, text }),
  rewrite: (id, version) => request('POST', `/api/inquiries/${id}/rewrite`, { version }),
  handoff: (id, version) => request('POST', `/api/inquiries/${id}/handoff`, { version }),
  manualReply: (id, version, text) => request('POST', `/api/inquiries/${id}/manual-reply`, { version, text }),
  // 빠른 승인: items = [{ id, version }]. 서버가 문의마다 조건을 다시 확인해 승인하거나 건너뛴다.
  quickApprove: (items) => request('POST', '/api/inquiries/quick-approve', { items }),
  // 비슷한 지난 문의 (처리 완료된 문의와 그 최종 답장)
  getSimilar: (id) => request('GET', `/api/inquiries/${id}/similar`),

  // 위험 표현, 설정
  riskCheck: (text) => request('POST', '/api/risk-check', { text }),
  getSettings: () => request('GET', '/api/settings'),
  putThreshold: (value) => request('PUT', '/api/settings/confidence-threshold', { value }),
  listPhrases: () => request('GET', '/api/risky-phrases'),
  addPhrase: (phrase) => request('POST', '/api/risky-phrases', { phrase }),

  // 작업 기록
  listLogs: ({ agent, action } = {}) => request('GET', `/api/action-logs${query({ agent, action })}`),

  // range: 7 같은 숫자(최근 며칠, 1이면 오늘) 또는 { start, end }(직접 지정, YYYY-MM-DD)
  getInquiryStats: (range) =>
    request(
      'GET',
      typeof range === 'object' ? `/api/stats/inquiries?start=${range.start}&end=${range.end}` : `/api/stats/inquiries?days=${range}`,
    ),
}
