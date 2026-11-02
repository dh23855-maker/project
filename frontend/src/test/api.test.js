import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, setUnauthorizedHandler } from '../api.js'
import { classificationText, formatTime, snippet } from '../format.js'
import { jsonResponse } from './utils.jsx'

afterEach(() => {
  vi.unstubAllGlobals()
  setUnauthorizedHandler(null)
})

const stub = (response) => {
  const fetchMock = vi.fn(async () => response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('api', () => {
  it('성공하면 JSON을 돌려주고, 본문이 있으면 JSON으로 보낸다', async () => {
    const fetchMock = stub(jsonResponse(200, { ok: 1 }))
    await expect(api.approve(3, 7)).resolves.toEqual({ ok: 1 })
    const [url, options] = fetchMock.mock.calls[0]
    expect(url).toBe('/api/inquiries/3/approve')
    expect(options.method).toBe('POST')
    expect(JSON.parse(options.body)).toEqual({ version: 7 })
    expect(options.headers['Content-Type']).toBe('application/json')
  })

  it('204는 본문 없이 성공으로 본다', async () => {
    stub(jsonResponse(204))
    await expect(api.logout()).resolves.toBeNull()
  })

  it('서버의 detail 문장을 ApiError 메시지로 쓴다', async () => {
    stub(jsonResponse(400, { detail: '문의 내용을 입력하세요.' }))
    await expect(api.createInquiry('')).rejects.toMatchObject({ status: 400, message: '문의 내용을 입력하세요.' })
  })

  it('충돌(409)이면 서버가 준 최신 문의를 에러에 담는다', async () => {
    stub(jsonResponse(409, { detail: '다른 상담사가 이미 처리했습니다.', inquiry: { id: 1, status: 'done' } }))
    const error = await api.approve(1, 0).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.inquiry).toEqual({ id: 1, status: 'done' })
  })

  it('형식 오류(422 목록) 등 알 수 없는 오류는 일반 안내로 바꾼다', async () => {
    stub(jsonResponse(422, { detail: [{ msg: 'field required' }] }))
    await expect(api.putThreshold(70)).rejects.toMatchObject({ message: expect.stringContaining('요청을 처리하지 못했습니다') })
  })

  it('서버가 꺼져 본문 없는 5xx가 오면 연결 안내로 바꾸고, 본문이 있는 5xx는 서버의 말을 그대로 쓴다', async () => {
    stub(jsonResponse(502))
    await expect(api.listInquiries()).rejects.toMatchObject({ status: 502, message: expect.stringContaining('서버(backend)가 켜져 있는지') })
    stub(jsonResponse(500, { detail: '서버 내부 오류' }))
    await expect(api.listInquiries()).rejects.toMatchObject({ status: 500, message: '서버 내부 오류' })
  })

  it('서버에 연결하지 못하면 연결 안내를 준다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('x') }))
    await expect(api.listInquiries()).rejects.toMatchObject({ status: 0, message: expect.stringContaining('서버에 연결하지 못했습니다') })
  })

  it('로그인이 풀리면(401) 알리지만, 로그인·확인 요청의 401은 조용히 넘긴다', async () => {
    const handler = vi.fn()
    setUnauthorizedHandler(handler)
    stub(jsonResponse(401, { detail: '로그인이 필요합니다.' }))
    await expect(api.listInquiries()).rejects.toThrow()
    expect(handler).toHaveBeenCalledTimes(1)
    await expect(api.login('kim', 'bad')).rejects.toThrow()
    await expect(api.me()).rejects.toThrow()
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('작업 기록 조회는 비어 있는 조건을 주소에 넣지 않는다', async () => {
    const fetchMock = stub(jsonResponse(200, []))
    await api.listLogs({ agent: '', action: '' })
    await api.listLogs({ agent: 'park' })
    await api.listLogs({ agent: 'park', action: 'edit' })
    expect(fetchMock.mock.calls.map((c) => c[0])).toEqual([
      '/api/action-logs',
      '/api/action-logs?agent=park',
      '/api/action-logs?agent=park&action=edit',
    ])
  })
})

describe('format', () => {
  it('snippet은 줄바꿈을 공백으로 줄이고 길면 자른다', () => {
    expect(snippet('가\n\n나   다')).toBe('가 나 다')
    expect(snippet('가'.repeat(50), 10)).toBe(`${'가'.repeat(10)}…`)
    expect(snippet(null)).toBe('')
  })

  it('classificationText', () => {
    expect(classificationText({ predicted_label_ko: '배송', confidence_percent: 88.5 })).toBe('배송 (확신도 88.5%)')
    expect(classificationText({ predicted_label_ko: null })).toBe('분류 결과 없음')
  })

  it('formatTime은 잘못된 값에 빈 글자를 돌려준다', () => {
    expect(formatTime(null)).toBe('')
    expect(formatTime('날짜 아님')).toBe('')
    expect(formatTime('2026-11-02T10:30:00+09:00')).not.toBe('')
  })
})
