import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { agent, jsonResponse, makeDetail, mockServer, renderApp, toListItem } from './utils.jsx'

afterEach(() => {
  vi.unstubAllGlobals()
})

const csvFile = (text, name = '문의.csv') => new File([new TextEncoder().encode(text)], name, { type: 'text/csv' })

// 서버: 등록 요청은 body 글자에 따라 성공·실패를 정한다. 목록은 등록된 문의가 쌓인다.
function setup({ fail = {}, failStatus = 400 } = {}) {
  const list = [toListItem(makeDetail({ id: 1 }))]
  let nextId = 10
  const posted = []
  const server = mockServer({
    'GET /api/auth/me': agent,
    'GET /api/inquiries': () => [...list],
    'GET /api/inquiries/1': makeDetail({ id: 1 }),
    'POST /api/inquiries': ({ body }) => {
      posted.push(body.body)
      const message = Object.entries(fail).find(([key]) => body.body.includes(key))?.[1]
      if (message) return jsonResponse(failStatus, { detail: message })
      const created = makeDetail({ id: nextId++, body: body.body })
      list.unshift(toListItem(created))
      return jsonResponse(201, created)
    },
  })
  return { server, list, posted }
}

async function open() {
  renderApp()
  await screen.findByRole('heading', { name: '문의 #1' })
  await userEvent.click(screen.getByRole('button', { name: 'CSV로 여러 개 올리기' }))
  return screen.getByRole('dialog', { name: 'CSV로 문의 여러 개 올리기' })
}
const upload = async (text, name) => userEvent.upload(screen.getByLabelText('CSV 파일 선택'), csvFile(text, name))
const dialog = () => within(screen.getByRole('dialog'))

describe('CSV로 문의 여러 개 올리기', () => {
  it('버튼을 누르면 안내와 예시 파일 링크가 있는 창이 열리고, 닫으면 사라진다', async () => {
    setup()
    await open()
    expect(dialog().getByText(/한 번에 30개까지, 문의 하나는 1000자까지/)).toBeInTheDocument()
    expect(dialog().getByText(/하나가 실패해도 그 문의만 실패로 알려 주고 나머지는 계속/)).toBeInTheDocument()
    expect(dialog().getByRole('link', { name: '예시 파일 받기' })).toHaveAttribute('download', '문의_예시.csv')
    expect(dialog().getByRole('button', { name: '등록 시작' })).toBeDisabled() // 파일을 고르기 전에는 시작할 수 없다
    await userEvent.click(dialog().getByRole('button', { name: '닫기' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('파일을 고르면 찾은 문의 개수와 미리보기를 보여 주고, 시작하면 모두 등록한다', async () => {
    const { posted, server } = setup()
    await open()
    await upload('문의\n첫째 문의입니다\n\n둘째 문의입니다\n셋째 문의입니다')
    expect(await dialog().findByText('3개', { selector: 'strong' })).toBeInTheDocument()
    expect(dialog().getByText('(빈 줄 1개는 건너뜀)')).toBeInTheDocument()
    expect(dialog().getByText('첫째 문의입니다')).toBeInTheDocument()
    expect(server.called('POST', '/api/inquiries')).toHaveLength(0) // 시작하기 전에는 보내지 않는다

    await userEvent.click(dialog().getByRole('button', { name: '3개 등록 시작' }))
    expect(await dialog().findByText('3개 등록')).toBeInTheDocument()
    expect(posted).toEqual(['첫째 문의입니다', '둘째 문의입니다', '셋째 문의입니다']) // 차례대로
    expect(dialog().queryByRole('list', { name: '실패한 문의' })).not.toBeInTheDocument()

    await userEvent.click(dialog().getByRole('button', { name: '닫기' }))
    // 등록한 문의가 받은 문의 목록에 들어와 있다
    const list = within(screen.getByRole('list', { name: '문의 목록' }))
    expect(await list.findByText(/셋째 문의입니다/)).toBeInTheDocument()
    expect(screen.getByText('4건')).toBeInTheDocument()
  })

  it('일부가 실패해도 실패한 것만 빼고 다음 문의를 이어서 등록하고, 실패 목록을 보여 준다', async () => {
    const { posted } = setup({ fail: { 문제: '지금은 등록할 수 없습니다.' } })
    await open()
    await upload('문의\n가 문의\n문제 있는 문의\n다 문의\n문제 또 있음\n마 문의')
    await userEvent.click(await dialog().findByRole('button', { name: '5개 등록 시작' }))

    expect(await dialog().findByText('3개 등록')).toBeInTheDocument()
    expect(dialog().getByText(/2개 실패/)).toBeInTheDocument()
    expect(posted).toEqual(['가 문의', '문제 있는 문의', '다 문의', '문제 또 있음', '마 문의']) // 실패해도 계속 보냈다
    const failed = within(dialog().getByRole('list', { name: '실패한 문의' })).getAllByRole('listitem')
    expect(failed).toHaveLength(2)
    expect(failed[0]).toHaveTextContent('3번째 줄')
    expect(failed[0]).toHaveTextContent('문제 있는 문의')
    expect(failed[0]).toHaveTextContent('지금은 등록할 수 없습니다.')
    expect(failed[1]).toHaveTextContent('5번째 줄')
  })

  it('1000자를 넘는 문의는 서버에 보내지 않고 실패로 적은 뒤 계속한다', async () => {
    const { posted } = setup()
    await open()
    await upload(`문의\n짧은 문의\n${'가'.repeat(1001)}\n또 짧은 문의`)
    expect(await dialog().findByText(/1000자 초과: 등록되지 않음/)).toBeInTheDocument()
    await userEvent.click(dialog().getByRole('button', { name: '3개 등록 시작' }))
    expect(await dialog().findByText('2개 등록')).toBeInTheDocument()
    expect(posted).toEqual(['짧은 문의', '또 짧은 문의'])
    expect(within(dialog().getByRole('list', { name: '실패한 문의' })).getByText(/1000자를 넘어 보내지 않았습니다/)).toBeInTheDocument()
  })

  it('서버에 연결하지 못하면 나머지는 계속하지 않고 "등록하지 않음"으로 알린다', async () => {
    const { posted } = setup({ fail: { 둘째: '서버에 연결하지 못했습니다.' }, failStatus: 502 })
    await open()
    await upload('문의\n첫째\n둘째\n셋째\n넷째')
    // 502는 계속할 수 있는 실패다 (다음 문의가 될 수도 있다). 연결 자체가 끊긴 경우(fetch 예외)만 멈춘다.
    await userEvent.click(await dialog().findByRole('button', { name: '4개 등록 시작' }))
    expect(await dialog().findByText('3개 등록')).toBeInTheDocument()
    expect(posted).toHaveLength(4)
  })

  it('연결이 끊기면(fetch 오류) 멈추고 나머지는 등록하지 않았다고 알린다', async () => {
    const { server } = setup()
    const base = server.fetchMock
    let calls = 0
    vi.stubGlobal('fetch', async (url, options = {}) => {
      if (options.method === 'POST' && url === '/api/inquiries') {
        calls++
        if (calls === 2) throw new TypeError('Failed to fetch')
      }
      return base(url, options)
    })
    await open()
    await upload('문의\n하나\n둘\n셋\n넷')
    await userEvent.click(await dialog().findByRole('button', { name: '4개 등록 시작' }))
    expect(await dialog().findByText('1개 등록')).toBeInTheDocument()
    expect(dialog().getByText(/1개 실패/)).toBeInTheDocument()
    expect(dialog().getByText(/2개는 등록하지 않음/)).toBeInTheDocument()
    expect(dialog().getByText('서버에 연결하지 못해 중단했습니다.')).toBeInTheDocument()
    expect(calls).toBe(2) // 셋째, 넷째는 보내지 않았다
  })

  it('로그인이 풀리면(401) 멈춘다', async () => {
    const { posted } = setup({ fail: { 둘: '로그인이 필요합니다.' }, failStatus: 401 })
    await open()
    await upload('문의\n하나\n둘\n셋')
    await userEvent.click(await dialog().findByRole('button', { name: '3개 등록 시작' }))
    await waitFor(() => expect(posted).toEqual(['하나', '둘']))
  })

  it('진행 중에는 몇 번째인지 보여 주고, [중단]을 누르면 지금 문의까지만 하고 멈춘다', async () => {
    const { server } = setup()
    const base = server.fetchMock
    const gates = []
    vi.stubGlobal('fetch', (url, options = {}) => {
      if (options.method === 'POST' && url === '/api/inquiries') {
        return new Promise((resolve) => gates.push(() => resolve(base(url, options))))
      }
      return base(url, options)
    })
    await open()
    await upload('문의\n하나\n둘\n셋')
    await userEvent.click(await dialog().findByRole('button', { name: '3개 등록 시작' }))

    expect(await dialog().findByRole('status')).toHaveTextContent('1 / 3 번째 문의를 분류하고 초안을 만드는 중')
    expect(dialog().getByRole('progressbar', { name: '등록 진행 상황' })).toHaveAttribute('aria-valuenow', '0')
    await userEvent.click(dialog().getByRole('button', { name: /중단/ }))
    await act(async () => gates[0]())

    expect(await dialog().findByText('1개 등록')).toBeInTheDocument()
    expect(dialog().getByText(/2개는 등록하지 않음/)).toBeInTheDocument()
    expect(dialog().getByText('중단했습니다.')).toBeInTheDocument()
    expect(gates).toHaveLength(1)
  })

  it('진행 중에는 문의가 하나 끝날 때마다 숫자가 올라간다', async () => {
    const { server } = setup()
    const base = server.fetchMock
    const gates = []
    vi.stubGlobal('fetch', (url, options = {}) => {
      if (options.method === 'POST' && url === '/api/inquiries') {
        return new Promise((resolve) => gates.push(() => resolve(base(url, options))))
      }
      return base(url, options)
    })
    await open()
    await upload('문의\n하나\n둘')
    await userEvent.click(await dialog().findByRole('button', { name: '2개 등록 시작' }))
    expect(await dialog().findByText('1 / 2')).toBeInTheDocument()
    await act(async () => gates[0]())
    expect(await dialog().findByText('2 / 2')).toBeInTheDocument()
    expect(dialog().getByRole('progressbar')).toHaveAttribute('aria-valuenow', '1')
    await act(async () => gates[1]())
    expect(await dialog().findByText('2개 등록')).toBeInTheDocument()
  })

  it('31개 이상이면 올리지 않고 나눠 올리라고 안내한다', async () => {
    setup()
    await open()
    await upload(['문의', ...Array.from({ length: 31 }, (_, i) => `문의 ${i + 1}`)].join('\n'))
    expect(await dialog().findByRole('alert')).toHaveTextContent('한 번에 30개까지 올릴 수 있습니다. 이 파일에는 31개가 있습니다.')
    expect(dialog().getByRole('button', { name: '등록 시작' })).toBeDisabled()
  })

  it('30개는 올릴 수 있다', async () => {
    setup()
    await open()
    await upload(['문의', ...Array.from({ length: 30 }, (_, i) => `문의 ${i + 1}`)].join('\n'))
    expect(await dialog().findByRole('button', { name: '30개 등록 시작' })).toBeEnabled()
  })

  it('문의가 없는 파일은 안내만 한다', async () => {
    setup()
    await open()
    await upload('문의\n\n')
    expect(await dialog().findByRole('alert')).toHaveTextContent('문의를 찾지 못했습니다')
    expect(dialog().getByRole('button', { name: '등록 시작' })).toBeDisabled()
  })

  it('너무 큰 파일은 읽지 않고 안내한다', async () => {
    setup()
    await open()
    const big = new File(['가'.repeat(10)], '큰파일.csv', { type: 'text/csv' })
    Object.defineProperty(big, 'size', { value: 2 * 1024 * 1024 })
    await userEvent.upload(screen.getByLabelText('CSV 파일 선택'), big)
    expect(await dialog().findByRole('alert')).toHaveTextContent('파일이 너무 큽니다')
  })

  it('따옴표로 감싼 여러 줄 문의와 쉼표가 들어 있는 문의도 한 개로 등록한다', async () => {
    const { posted } = setup()
    await open()
    await upload('문의\n"첫 줄, 쉼표 있음\n둘째 줄"\n보통 문의')
    await userEvent.click(await dialog().findByRole('button', { name: '2개 등록 시작' }))
    await dialog().findByText('2개 등록')
    expect(posted).toEqual(['첫 줄, 쉼표 있음\n둘째 줄', '보통 문의'])
  })

  it('다른 파일을 다시 고를 수 있다', async () => {
    setup()
    await open()
    await upload('문의\n하나', '첫번째.csv')
    expect(await dialog().findByText('첫번째.csv')).toBeInTheDocument()
    await upload('문의\n하나\n둘\n셋', '두번째.csv')
    expect(await dialog().findByText('두번째.csv')).toBeInTheDocument()
    expect(dialog().getByText('3개', { selector: 'strong' })).toBeInTheDocument()
  })
})
