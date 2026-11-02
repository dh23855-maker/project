import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api.js'
import InquiryDetail from '../components/InquiryDetail.jsx'
import InquiryList from '../components/InquiryList.jsx'
import NewInquiryForm from '../components/NewInquiryForm.jsx'

// 상담 화면: 왼쪽 문의 목록, 오른쪽 선택한 문의 처리.
export default function ConsultPage() {
  const [items, setItems] = useState([])
  const [listState, setListState] = useState('loading')
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailState, setDetailState] = useState('idle')
  const [notice, setNotice] = useState(null) // { kind: 'error' | 'success', text }
  const [busyText, setBusyText] = useState(null)
  const shownId = useRef(null) // 지금 화면에 이미 받아 둔 문의의 번호

  useEffect(() => {
    shownId.current = detail?.id ?? null
  }, [detail])

  const refreshList = useCallback(async () => {
    try {
      const list = await api.listInquiries()
      setItems(list)
      setListState('ready')
      return list
    } catch {
      setListState('error')
      return []
    }
  }, [])

  // 처음 열면 목록을 불러오고, 상담사가 먼저 처리할 승인 대기 문의가 있으면 그것을, 없으면 맨 위 문의를 연다
  useEffect(() => {
    refreshList().then((list) => {
      const first = list.find((item) => item.status === 'awaiting_approval') ?? list[0]
      setSelectedId((current) => current ?? first?.id ?? null)
    })
  }, [refreshList])

  // 선택한 문의의 자세한 내용(초안, 근거, 경고)을 불러온다
  useEffect(() => {
    if (selectedId == null) return
    if (shownId.current === selectedId) return // 방금 등록해서 이미 받아 둔 문의는 다시 불러오지 않는다
    let cancelled = false
    setDetailState('loading')
    api
      .getInquiry(selectedId)
      .then((result) => {
        if (cancelled) return
        setDetail(result)
        setDetailState('ready')
      })
      .catch((e) => {
        if (cancelled) return
        setDetailState('error')
        setNotice({ kind: 'error', text: e.message })
      })
    return () => {
      cancelled = true
    }
  }, [selectedId])

  function select(id) {
    setNotice(null)
    setSelectedId(id)
  }

  // 버튼 하나를 실행한다. 충돌(409)이면 서버가 돌려준 최신 상태로 화면을 바꾼다.
  async function run(pendingText, action, successText) {
    setBusyText(pendingText)
    setNotice(null)
    try {
      const result = await action()
      setDetail(result)
      setNotice({ kind: 'success', text: successText })
      await refreshList()
    } catch (e) {
      if (e instanceof ApiError && e.inquiry) {
        setDetail(e.inquiry)
        refreshList()
      }
      setNotice({ kind: 'error', text: e.message })
    } finally {
      setBusyText(null)
    }
  }

  const handlers = detail && {
    onApprove: () => run('승인하는 중...', () => api.approve(detail.id, detail.version), '승인했습니다.'),
    onEdit: (text) =>
      run('저장하는 중...', () => api.edit(detail.id, detail.version, text), '고친 답장을 저장했습니다.'),
    onRewrite: () =>
      run('새 초안을 만드는 중... (몇 초 걸립니다)', () => api.rewrite(detail.id, detail.version), '새 초안을 만들었습니다.'),
    onHandoff: () =>
      run('넘기는 중...', () => api.handoff(detail.id, detail.version), '직접 작성으로 넘겼습니다.'),
    onManualReply: (text) =>
      run('등록하는 중...', () => api.manualReply(detail.id, detail.version, text), '답장을 등록했습니다.'),
  }

  async function created(inquiry) {
    setNotice({ kind: 'success', text: `새 문의 #${inquiry.id}를 등록했습니다.` })
    setDetail(inquiry)
    setDetailState('ready')
    setSelectedId(inquiry.id)
    await refreshList()
  }

  return (
    <div className="consult">
      <aside className="consult-side" aria-label="받은편지함">
        <div className="side-head">
          <h2>받은편지함</h2>
          <span className="muted">{items.length}건</span>
        </div>
        <div className="side-list">
          <InquiryList items={items} selectedId={selectedId} onSelect={select} state={listState} />
        </div>
        <NewInquiryForm onCreated={created} disabled={Boolean(busyText)} />
      </aside>

      <main className="consult-main">
        {notice && (
          <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
            {notice.text}
          </div>
        )}
        {detail && detailState !== 'loading' && handlers ? (
          <InquiryDetail detail={detail} busyText={busyText} handlers={handlers} />
        ) : (
          <p className="muted pad">
            {detailState === 'loading' ? '문의를 불러오는 중...' : '왼쪽에서 문의를 선택하세요.'}
          </p>
        )}
      </main>
    </div>
  )
}
