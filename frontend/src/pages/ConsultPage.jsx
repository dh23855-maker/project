import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../api.js'
import InquiryDetail from '../components/InquiryDetail.jsx'
import InquiryList, {
  DEFAULT_FILTER,
  DEFAULT_SORT,
  QUICK_FILTER,
  SORT_OPTIONS,
  StatusTabs,
  filterInquiries,
} from '../components/InquiryList.jsx'
import BatchUpload from '../components/BatchUpload.jsx'
import NewInquiryForm from '../components/NewInquiryForm.jsx'
import QuickApprove from '../components/QuickApprove.jsx'
import SelectMenu from '../components/SelectMenu.jsx'

const SIDE_KEY = 'consult-side-width'
export const SIDE_DEFAULT = 440
export const SIDE_MIN = 280
const SIDE_MAX_RATIO = 0.6 // 목록은 화면 너비의 60%까지만 넓힌다

function maxSideWidth() {
  return Math.max(SIDE_MIN, Math.floor(window.innerWidth * SIDE_MAX_RATIO))
}

export function clampSideWidth(width) {
  return Math.min(Math.max(Math.round(width), SIDE_MIN), maxSideWidth())
}

// 마지막으로 정한 목록 너비를 기억한다 (브라우저에 저장되지 않으면 기본값)
function loadSideWidth() {
  try {
    const saved = Number(window.localStorage.getItem(SIDE_KEY))
    if (saved) return clampSideWidth(saved)
  } catch {
    // 저장소를 못 쓰는 환경이면 기본값을 쓴다
  }
  return clampSideWidth(SIDE_DEFAULT)
}

// 상담 화면: 왼쪽 문의 목록, 오른쪽 선택한 문의 처리. 가운데 선을 끌어 목록 너비를 바꿀 수 있다.
export default function ConsultPage() {
  const [items, setItems] = useState([])
  const [listState, setListState] = useState('loading')
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailState, setDetailState] = useState('idle')
  const [notice, setNotice] = useState(null) // { kind: 'error' | 'success', text }
  const [busyText, setBusyText] = useState(null)
  const [filter, setFilter] = useState(DEFAULT_FILTER)
  const [sort, setSort] = useState(DEFAULT_SORT)
  const [sideWidth, setSideWidth] = useState(loadSideWidth)
  const [scrollEl, setScrollEl] = useState(null) // 문의 내용이 스크롤되는 칸
  const [dockEl, setDockEl] = useState(null) // 버튼이 스크롤 밖으로 나갔을 때 아래에 붙여 보여 줄 자리
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

  // 다른 문의를 열면 내용 칸을 맨 위부터 보여 준다
  useEffect(() => {
    if (scrollEl) scrollEl.scrollTop = 0
  }, [detail?.id, scrollEl])

  function select(id) {
    setNotice(null)
    setSelectedId(id)
  }

  // 처리를 끝낸 뒤 이어서 열 문의: 지금 목록(탭·정렬 그대로)에서 아래쪽의 아직 처리 안 한 문의,
  // 아래에 없으면 위쪽에서 가장 가까운 것. 없으면 null (그 자리에 머문다).
  function nextPendingId() {
    const shown = filterInquiries(items, filter, sort)
    const index = shown.findIndex((item) => item.id === detail.id)
    const pending = (item) => item.status !== 'done' && item.id !== detail.id
    const below = shown.slice(index + 1).find(pending)
    const above = shown.slice(0, Math.max(index, 0)).reverse().find(pending)
    return (below ?? above)?.id ?? null
  }

  // 버튼 하나를 실행한다. 충돌(409)이면 서버가 돌려준 최신 상태로 화면을 바꾼다.
  // advance가 true이면 처리가 끝난 뒤 다음 문의로 자동으로 넘어간다.
  async function run(pendingText, action, successText, { advance = false } = {}) {
    const nextId = advance ? nextPendingId() : null
    setBusyText(pendingText)
    setNotice(null)
    try {
      const result = await action()
      if (nextId != null) {
        setNotice({ kind: 'success', text: `${successText} 다음 문의 #${nextId}로 이동했습니다.` })
        setSelectedId(nextId)
      } else {
        setDetail(result)
        setNotice({ kind: 'success', text: successText })
      }
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

  function saveSideWidth(width) {
    try {
      window.localStorage.setItem(SIDE_KEY, String(width))
    } catch {
      // 저장하지 못해도 이번 화면에서는 바뀐 너비로 보인다
    }
  }

  function startDrag(event) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sideWidth
    let latest = startWidth
    const move = (e) => {
      latest = clampSideWidth(startWidth + e.clientX - startX)
      setSideWidth(latest)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      document.body.classList.remove('resizing')
      saveSideWidth(latest)
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  function resizeByKey(event) {
    const step = event.shiftKey ? 80 : 20
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const width = clampSideWidth(sideWidth + (event.key === 'ArrowRight' ? step : -step))
    setSideWidth(width)
    saveSideWidth(width)
  }

  const handlers = detail && {
    onApprove: () =>
      run('승인하는 중...', () => api.approve(detail.id, detail.version), '승인했습니다.', { advance: true }),
    // 승인 대기 문의를 고쳐 저장하면 처리가 끝나므로 다음으로 넘어간다. 처리 완료 문의의 [다시 수정]은 그 자리에 머문다.
    onEdit: (text) =>
      run('저장하는 중...', () => api.edit(detail.id, detail.version, text), '고친 답장을 저장했습니다.', {
        advance: detail.status === 'awaiting_approval',
      }),
    onRewrite: () =>
      run('새 초안을 만드는 중... (몇 초 걸립니다)', () => api.rewrite(detail.id, detail.version), '새 초안을 만들었습니다.'),
    onHandoff: () =>
      run('넘기는 중...', () => api.handoff(detail.id, detail.version), '직접 작성으로 넘겼습니다.'),
    onManualReply: (text) =>
      run('등록하는 중...', () => api.manualReply(detail.id, detail.version, text), '답장을 등록했습니다.', {
        advance: true,
      }),
  }

  // 빠른 승인이 끝나면 목록을 새로 받고, 열어 둔 문의가 승인되었을 수 있으니 그것도 새로 받는다
  async function quickApproved() {
    await refreshList()
    if (selectedId == null) return
    try {
      setDetail(await api.getInquiry(selectedId))
    } catch {
      // 못 받아도 목록은 이미 새로 고쳤다
    }
  }

  async function created(inquiry) {
    setNotice({ kind: 'success', text: `새 문의 #${inquiry.id}를 등록했습니다.` })
    setDetail(inquiry)
    setDetailState('ready')
    setSelectedId(inquiry.id)
    await refreshList()
  }

  return (
    <div className="consult" style={{ '--side-width': `${sideWidth}px` }}>
      <aside className="consult-side" aria-label="받은 문의">
        <div className="side-head">
          <h2>받은 문의</h2>
          <span className="muted">{items.length}건</span>
          {filter === QUICK_FILTER && (
            <span className="side-head-action">
              <QuickApprove items={filterInquiries(items, QUICK_FILTER, sort)} onDone={quickApproved} />
            </span>
          )}
          <SelectMenu
            className="side-sort-select"
            label="정렬"
            variant="pill"
            align="right"
            value={sort}
            onChange={setSort}
            options={SORT_OPTIONS}
          />
        </div>
        <StatusTabs items={items} filter={filter} onChange={setFilter} />
        <div className="side-list">
          <InquiryList items={items} selectedId={selectedId} onSelect={select} state={listState} filter={filter} sort={sort} />
        </div>
        <NewInquiryForm
          onCreated={created}
          disabled={Boolean(busyText)}
          headerExtra={<BatchUpload onProgress={refreshList} onFinished={refreshList} />}
        />
      </aside>

      <div
        className="splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="목록과 문의 내용의 너비 조절"
        aria-valuenow={sideWidth}
        aria-valuemin={SIDE_MIN}
        tabIndex={0}
        onPointerDown={startDrag}
        onKeyDown={resizeByKey}
      />

      <main className="consult-main">
        <div className="consult-scroll" ref={setScrollEl}>
          {notice && (
            <div className={`notice notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
              {notice.text}
            </div>
          )}
          {detail && detailState !== 'loading' && handlers ? (
            <InquiryDetail detail={detail} busyText={busyText} handlers={handlers} scrollRoot={scrollEl} dock={dockEl} />
          ) : (
            <p className="muted pad">
              {detailState === 'loading' ? '문의를 불러오는 중...' : '왼쪽에서 문의를 선택하세요.'}
            </p>
          )}
        </div>
        <div className="action-dock" ref={setDockEl} />
      </main>
    </div>
  )
}
