import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ApiError, api } from '../api.js'
import { snippet } from '../format.js'
import {
  MAX_BATCH,
  MAX_FILE_BYTES,
  MAX_LENGTH,
  SAMPLE_CSV,
  decodeCsv,
  extractInquiries,
  parseCsv,
  readFileBytes,
} from '../csv.js'

const TOO_LONG = `${MAX_LENGTH}자를 넘어 보내지 않았습니다.`
// 이 두 가지는 다음 문의도 실패하므로 계속하지 않는다: 서버에 연결할 수 없음(0), 로그인이 풀림(401)
const STOP_STATUSES = [0, 401]

// CSV 파일로 문의 여러 개를 올린다.
// 문의를 하나씩 차례로 등록하며(분류와 초안 만들기가 문의마다 몇 초 걸린다) 진행 상황을 보여 준다.
// 한 개가 실패해도 그 문의만 실패로 적어 두고 다음 문의를 이어서 등록한다.
export default function BatchUpload({ onProgress, onFinished }) {
  const [phase, setPhase] = useState('closed') // closed | preview | running | done
  const [error, setError] = useState('')
  const [plan, setPlan] = useState(null) // { fileName, items, skippedEmpty, hasHeader }
  const [progress, setProgress] = useState({ index: 0, ok: 0, failed: [], notDone: 0, stopped: '' })
  const stopRequested = useRef(false)
  const fileInput = useRef(null)

  function close() {
    setPhase('closed')
    setPlan(null)
    setError('')
    if (fileInput.current) fileInput.current.value = ''
  }

  async function choose(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')
    if (file.size > MAX_FILE_BYTES) {
      setError(`파일이 너무 큽니다 (${Math.ceil(file.size / 1024)}KB). 1MB 이하의 CSV 파일을 올려 주세요.`)
      setPhase('preview')
      setPlan(null)
      return
    }
    try {
      const rows = parseCsv(decodeCsv(await readFileBytes(file)))
      const found = extractInquiries(rows)
      if (found.items.length === 0) {
        setError('문의를 찾지 못했습니다. 첫 번째 칸(또는 "문의" 머리글이 있는 칸)에 문의를 한 줄에 하나씩 적어 주세요.')
        setPlan(null)
      } else if (found.items.length > MAX_BATCH) {
        setError(`한 번에 ${MAX_BATCH}개까지 올릴 수 있습니다. 이 파일에는 ${found.items.length}개가 있습니다. 나눠서 올려 주세요.`)
        setPlan(null)
      } else {
        setPlan({ fileName: file.name, ...found })
      }
    } catch (e) {
      setError(e.message || '파일을 읽지 못했습니다.')
      setPlan(null)
    }
    setPhase('preview')
  }

  async function start() {
    stopRequested.current = false
    const total = plan.items.length
    setProgress({ index: 0, ok: 0, failed: [], notDone: 0, stopped: '' })
    setPhase('running')
    const failed = []
    let ok = 0
    let stopped = ''
    let index = 0
    for (; index < total; index++) {
      if (stopRequested.current) {
        stopped = '중단했습니다.'
        break
      }
      const item = plan.items[index]
      setProgress({ index, ok, failed: [...failed], notDone: 0, stopped: '' })
      if (item.text.length > MAX_LENGTH) {
        failed.push({ ...item, reason: TOO_LONG })
        continue
      }
      try {
        const created = await api.createInquiry(item.text)
        ok++
        await onProgress?.(created)
      } catch (e) {
        const reason = e instanceof ApiError ? e.message : '등록하지 못했습니다.'
        failed.push({ ...item, reason })
        if (e instanceof ApiError && STOP_STATUSES.includes(e.status)) {
          stopped = e.status === 401 ? '로그인이 풀려 중단했습니다.' : '서버에 연결하지 못해 중단했습니다.'
          index++
          break
        }
      }
    }
    setProgress({ index: Math.min(index, total), ok, failed, notDone: total - Math.min(index, total), stopped })
    setPhase('done')
    await onFinished?.()
  }

  const total = plan?.items.length ?? 0
  const sampleHref = `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`

  return (
    <>
      <button type="button" className="link-button" onClick={() => setPhase('preview')}>
        CSV로 여러 개 올리기
      </button>
      <input ref={fileInput} type="file" accept=".csv,text/csv" className="visually-hidden" aria-label="CSV 파일 선택" onChange={choose} />

      {phase !== 'closed' &&
        createPortal(
        <div className="modal-backdrop" role="presentation">
          <div className="modal" role="dialog" aria-modal="true" aria-label="CSV로 문의 여러 개 올리기">
            <h2>CSV로 문의 여러 개 올리기</h2>

            {phase === 'preview' && (
              <>
                <ul className="modal-guide">
                  <li>한 줄에 문의 하나씩, 첫 번째 칸(또는 "문의" 머리글이 있는 칸)에 적습니다.</li>
                  <li>
                    한 번에 {MAX_BATCH}개까지, 문의 하나는 {MAX_LENGTH}자까지입니다.
                  </li>
                  <li>문의마다 분류와 초안을 만들어서 개수만큼 시간(문의당 몇 초)과 OpenAI 비용이 듭니다.</li>
                  <li>하나가 실패해도 그 문의만 실패로 알려 주고 나머지는 계속 등록합니다.</li>
                </ul>
                <a className="sample-link" href={sampleHref} download="문의_예시.csv">
                  예시 파일 받기
                </a>

                {error && (
                  <p className="field-error" role="alert">
                    {error}
                  </p>
                )}

                {plan ? (
                  <div className="plan" aria-label="올릴 문의 미리보기">
                    <p>
                      <strong>{plan.fileName}</strong>에서 문의 <strong>{total}개</strong>를 찾았습니다.
                      {plan.skippedEmpty > 0 && <span className="muted"> (빈 줄 {plan.skippedEmpty}개는 건너뜀)</span>}
                    </p>
                    <ol className="plan-list">
                      {plan.items.slice(0, 5).map((item) => (
                        <li key={item.line}>
                          {snippet(item.text, 50)}
                          {item.text.length > MAX_LENGTH && <span className="field-error"> ({MAX_LENGTH}자 초과: 등록되지 않음)</span>}
                        </li>
                      ))}
                      {total > 5 && <li className="muted">… 외 {total - 5}개</li>}
                    </ol>
                  </div>
                ) : null}

                <div className="modal-actions">
                  <button type="button" className="btn" onClick={() => fileInput.current?.click()}>
                    {plan ? '다른 파일 선택' : 'CSV 파일 선택'}
                  </button>
                  <span className="spacer" />
                  <button type="button" className="btn" onClick={close}>
                    닫기
                  </button>
                  <button type="button" className="btn btn-primary" onClick={start} disabled={!plan}>
                    {plan ? `${total}개 등록 시작` : '등록 시작'}
                  </button>
                </div>
              </>
            )}

            {phase === 'running' && (
              <>
                <p role="status" aria-live="polite" className="batch-status">
                  <strong>
                    {progress.index + 1} / {total}
                  </strong>{' '}
                  번째 문의를 분류하고 초안을 만드는 중... <span className="muted">(성공 {progress.ok}, 실패 {progress.failed.length})</span>
                </p>
                <div
                  className="progress"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={total}
                  aria-valuenow={progress.index}
                  aria-label="등록 진행 상황"
                >
                  <span className="progress-fill" style={{ width: `${(progress.index / total) * 100}%` }} />
                </div>
                <p className="muted">{snippet(plan.items[progress.index]?.text ?? '', 60)}</p>
                <div className="modal-actions">
                  <span className="spacer" />
                  <button type="button" className="btn" onClick={() => (stopRequested.current = true)}>
                    중단 (지금 문의까지만 하고 멈춥니다)
                  </button>
                </div>
              </>
            )}

            {phase === 'done' && (
              <>
                <p role="status" className="batch-status">
                  <strong>{progress.ok}개 등록</strong>
                  {progress.failed.length > 0 && <strong className="field-error"> · {progress.failed.length}개 실패</strong>}
                  {progress.notDone > 0 && <span className="muted"> · {progress.notDone}개는 등록하지 않음</span>}
                  <span className="muted"> (전체 {total}개)</span>
                </p>
                {progress.stopped && <p className="notice notice-error">{progress.stopped}</p>}
                <div className="progress" aria-hidden="true">
                  <span className="progress-fill" style={{ width: `${(progress.ok / total) * 100}%` }} />
                </div>
                {progress.failed.length > 0 && (
                  <>
                    <h3 className="sub-title">실패한 문의</h3>
                    <ul className="fail-list" aria-label="실패한 문의">
                      {progress.failed.map((f) => (
                        <li key={f.line}>
                          <span className="muted">{f.line}번째 줄</span> {snippet(f.text, 40)}
                          <span className="field-error"> — {f.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                <div className="modal-actions">
                  <span className="spacer" />
                  <button type="button" className="btn btn-primary" onClick={close}>
                    닫기
                  </button>
                </div>
              </>
            )}
          </div>
        </div>,
        document.body,
      )}
    </>
  )
}
