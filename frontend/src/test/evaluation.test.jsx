import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent, jsonResponse, mockServer, renderApp } from './utils.jsx'

afterEach(() => vi.unstubAllGlobals())

const LABELS = [
  ['buyer_delivery', '배송'],
  ['buyer_inspection_result', '검수 결과'],
  ['buyer_cancel_refund', '취소·환불'],
  ['buyer_payment', '결제'],
  ['seller_inspection_fail', '검수 불합격'],
  ['seller_penalty', '페널티'],
  ['seller_settlement', '정산'],
]

function makeRun(overrides = {}) {
  const per_label = Object.fromEntries(LABELS.map(([key]) => [key, { total: 20, correct: 15, accuracy: 0.75 }]))
  per_label.buyer_delivery = { total: 20, correct: 20, accuracy: 1.0 }
  per_label.seller_settlement = { total: 0, correct: 0, accuracy: null }
  return {
    id: 2,
    created_at: '2026-11-03T10:30:00+09:00',
    run_by_name: '김상담',
    total: 140,
    correct: 106,
    accuracy: 0.7571,
    description: '글자 조각 TF-IDF + 로지스틱 회귀',
    per_label,
    per_difficulty: {
      easy: { total: 47, correct: 45, accuracy: 0.9574 },
      medium: { total: 47, correct: 28, accuracy: 0.5957 },
      hard: { total: 46, correct: 23, accuracy: 0.5 },
    },
    confusions: [
      { true: 'buyer_cancel_refund', predicted: 'buyer_payment', count: 5 },
      { true: 'seller_penalty', predicted: 'seller_settlement', count: 2 },
    ],
    wrong: [
      { text: '쿠폰은 돌려받나요 결제는 어떻게', true: 'buyer_cancel_refund', predicted: 'buyer_payment', difficulty: 'hard', confidence: 0.52 },
    ],
    train_size: 541,
    eval_file: 'eval.csv',
    labels: LABELS.map(([key, ko]) => ({ key, ko })),
    difficulties: ['easy', 'medium', 'hard'],
    ...overrides,
  }
}

const summary = (run) => ({
  id: run.id,
  created_at: run.created_at,
  run_by_name: run.run_by_name,
  total: run.total,
  correct: run.correct,
  accuracy: run.accuracy,
  description: run.description,
})

const older = makeRun({
  id: 1,
  created_at: '2026-11-02T09:00:00+09:00',
  run_by_name: '박상담',
  correct: 84,
  accuracy: 0.6,
  confusions: [{ true: 'buyer_delivery', predicted: 'buyer_payment', count: 9 }],
  wrong: [],
})
const latest = makeRun()

const baseEval = (extra = {}) => ({
  'GET /api/auth/me': agent,
  'GET /api/evaluations': [summary(latest), summary(older)],
  'GET /api/evaluations/2': latest,
  'GET /api/evaluations/1': older,
  ...extra,
})

describe('성능 평가 화면', () => {
  it('메뉴에서 성능 평가 화면으로 갈 수 있다', async () => {
    mockServer({
      ...baseEval(),
      'GET /api/inquiries': [],
    })
    renderApp('/')
    await userEvent.click(await screen.findByRole('link', { name: '성능 평가' }))
    expect(await screen.findByRole('heading', { name: '성능 평가' })).toBeInTheDocument()
  })

  it('처음 열면 가장 최근 결과를 보여준다: 전체·종류별·난이도별 정확도와 헷갈린 부분', async () => {
    mockServer(baseEval())
    renderApp('/evaluation')

    const result = within(await screen.findByLabelText('평가 결과 2'))
    expect(result.getByText(/140개 중 106개/)).toBeInTheDocument()
    expect(result.getByText('(75.7%)')).toBeInTheDocument()
    expect(result.getByText(/학습용 문의 541개/)).toBeInTheDocument()

    // 7가지 종류가 모두 나온다. 문의가 없는 종류는 "-"
    const labels = within(result.getByRole('heading', { name: '종류별 정확도' }).closest('section'))
    for (const [, ko] of LABELS) expect(labels.getByText(ko)).toBeInTheDocument()
    expect(labels.getByText('20/20')).toBeInTheDocument()
    expect(labels.getByText('100.0%')).toBeInTheDocument()
    expect(labels.getAllByText('-').length).toBeGreaterThanOrEqual(2) // 정산: 맞힌 수와 정확도

    const difficulty = within(result.getByRole('heading', { name: '난이도별 정확도' }).closest('section'))
    expect(difficulty.getByText('난이도')).toBeInTheDocument() // 첫 칸 제목
    expect(labels.getByText('종류')).toBeInTheDocument()
    expect(difficulty.getByText('45/47')).toBeInTheDocument()
    expect(difficulty.getByText('어려움')).toBeInTheDocument()

    const confusion = within(result.getByRole('heading', { name: '헷갈린 부분' }).closest('section'))
    const firstRow = confusion.getAllByRole('row')[1]
    expect(within(firstRow).getByText('취소·환불')).toBeInTheDocument()
    expect(within(firstRow).getByText('결제')).toBeInTheDocument()
    expect(within(firstRow).getByText('5개')).toBeInTheDocument()

    await userEvent.click(confusion.getByText('틀린 문의 1개 보기'))
    expect(confusion.getByText('쿠폰은 돌려받나요 결제는 어떻게')).toBeInTheDocument()
    expect(confusion.getByText(/실제 취소·환불 → 모델 결제 \(확신도 52.0%\)/)).toBeInTheDocument()
  })

  it('이전 실행 결과 목록이 있고, [보기]를 누르면 그때의 결과를 다시 본다', async () => {
    const server = mockServer(baseEval())
    renderApp('/evaluation')
    await screen.findByLabelText('평가 결과 2')

    const history = within(screen.getByRole('heading', { name: '이전 실행 결과' }).closest('section'))
    expect(history.getByText('106/140 (75.7%)')).toBeInTheDocument()
    expect(history.getByText('84/140 (60.0%)')).toBeInTheDocument()
    expect(history.getByText('박상담')).toBeInTheDocument()

    await userEvent.click(history.getByRole('button', { name: /11\. 2\..* 결과 보기/ }))
    const result = within(await screen.findByLabelText('평가 결과 1'))
    expect(result.getByText(/140개 중 84개/)).toBeInTheDocument()
    expect(result.getByText('(60.0%)')).toBeInTheDocument()
    expect(server.called('GET', '/api/evaluations/1')).toHaveLength(1)
    expect(screen.queryByLabelText('평가 결과 2')).not.toBeInTheDocument()
  })

  it('기록이 없으면 안내를 보여주고, [평가 실행]을 누르면 서버에 요청해 결과와 이전 결과 목록을 채운다', async () => {
    let runs = []
    const server = mockServer({
      'GET /api/auth/me': agent,
      'GET /api/evaluations': () => runs,
      'POST /api/evaluations': () => {
        runs = [summary(latest)]
        return latest
      },
    })
    renderApp('/evaluation')
    expect(await screen.findByText(/아직 평가한 기록이 없습니다/)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: '평가 실행' }))
    const result = within(await screen.findByLabelText('평가 결과 2'))
    expect(result.getByText(/140개 중 106개/)).toBeInTheDocument()
    expect(server.called('POST', '/api/evaluations')).toHaveLength(1)
    expect(screen.queryByText(/아직 평가한 기록이 없습니다/)).not.toBeInTheDocument()
    const history = within(screen.getByRole('heading', { name: '이전 실행 결과' }).closest('section'))
    expect(history.getByText('106/140 (75.7%)')).toBeInTheDocument()
  })

  it('실행하는 동안 버튼을 잠그고 "평가하는 중..."을 보여준다', async () => {
    let finish
    mockServer({
      'GET /api/auth/me': agent,
      'GET /api/evaluations': [],
      'POST /api/evaluations': () => new Promise((resolve) => (finish = resolve)),
    })
    renderApp('/evaluation')
    await userEvent.click(await screen.findByRole('button', { name: '평가 실행' }))

    expect(await screen.findByText('평가하는 중...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '평가 실행' })).toBeDisabled()
    finish(latest)
    await waitFor(() => expect(screen.queryByText('평가하는 중...')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '평가 실행' })).toBeEnabled()
  })

  it('실행에 실패하면 서버의 안내를 보여주고, 보고 있던 결과는 그대로 둔다', async () => {
    mockServer(
      baseEval({
        'POST /api/evaluations': jsonResponse(409, { detail: '평가용 연습 문의 묶음이 준비되어 있지 않아 평가를 실행할 수 없습니다.' }),
      }),
    )
    renderApp('/evaluation')
    await screen.findByLabelText('평가 결과 2')
    await userEvent.click(screen.getByRole('button', { name: '평가 실행' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('평가용 연습 문의 묶음이 준비되어 있지 않아 평가를 실행할 수 없습니다.')
    expect(screen.getByLabelText('평가 결과 2')).toBeInTheDocument()
    expect(screen.getAllByRole('row').length).toBeGreaterThan(5)
  })

  it('실행 중 오류(500)면 저장하지 않았다는 안내를 그대로 보여준다', async () => {
    mockServer(
      baseEval({
        'POST /api/evaluations': jsonResponse(500, { detail: '평가를 끝까지 실행하지 못했습니다. 결과는 저장하지 않았습니다. 잠시 후 다시 시도해 주세요.' }),
      }),
    )
    renderApp('/evaluation')
    await screen.findByLabelText('평가 결과 2')
    await userEvent.click(screen.getByRole('button', { name: '평가 실행' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('결과는 저장하지 않았습니다')
  })

  it('목록을 불러오지 못하면 안내를 보여준다', async () => {
    mockServer({
      'GET /api/auth/me': agent,
      'GET /api/evaluations': jsonResponse(500, { detail: '서버 내부 오류' }),
    })
    renderApp('/evaluation')
    expect(await screen.findByRole('alert')).toHaveTextContent('서버 내부 오류')
  })
})
