import { useState } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api.js'

// 일괄 승인: 빠른 승인 탭의 목록(보이는 문의 모두)을 초안 그대로 한 번에 승인한다.
// 여러 건이 한꺼번에 나가므로 누르면 먼저 확인 창을 띄운다. 서버가 문의마다 조건을 다시 확인해서,
// 그 사이 조건이 달라졌거나 다른 상담사가 처리한 문의는 건너뛰고 이유를 알려 준다.
export default function QuickApprove({ items, onDone }) {
  const [phase, setPhase] = useState('closed') // closed | confirm | running | done
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const count = items.length

  function close() {
    setPhase('closed')
    setResult(null)
    setError('')
  }

  async function start() {
    setPhase('running')
    setError('')
    let outcome
    try {
      outcome = await api.quickApprove(items.map(({ id, version }) => ({ id, version })))
    } catch (e) {
      setError(e.message)
      setPhase('confirm')
      return
    }
    setResult(outcome)
    setPhase('done')
    await onDone?.() // 목록과 열려 있는 문의를 새로 불러온다
  }

  return (
    <>
      <button
        type="button"
        className="btn btn-primary btn-small quick-approve-button"
        onClick={() => setPhase('confirm')}
        disabled={count === 0}
      >
        일괄 승인
      </button>

      {phase !== 'closed' &&
        createPortal(
          <div className="modal-backdrop" role="presentation">
            <div className="modal" role="dialog" aria-modal="true" aria-label="일괄 승인">
              <h2>일괄 승인</h2>

              {(phase === 'confirm' || phase === 'running') && (
                <>
                  <p>
                    빠른 승인 탭의 문의 <strong>{count}건</strong>을 초안 그대로 한 번에 승인합니다.
                  </p>
                  <ul className="modal-guide">
                    <li>확신도 90% 초과, 규정 문서를 참고했고, 위험 표현 경고가 없는 초안만 빠른 승인 탭에 있습니다.</li>
                    <li>승인한 문의는 처리 완료가 되고 작업 기록에 "승인"으로 남습니다.</li>
                    <li>승인한 뒤에도 문의를 열어 [다시 수정]으로 답장을 고칠 수 있습니다.</li>
                    <li>승인해도 답장은 고객에게 실제로 발송되지 않습니다.</li>
                  </ul>
                  {error && (
                    <p className="field-error" role="alert">
                      {error}
                    </p>
                  )}
                  {phase === 'running' && (
                    <p role="status" className="batch-status">
                      승인하는 중...
                    </p>
                  )}
                  <div className="modal-actions">
                    <span className="spacer" />
                    <button type="button" className="btn" onClick={close} disabled={phase === 'running'}>
                      취소
                    </button>
                    <button type="button" className="btn btn-primary" onClick={start} disabled={phase === 'running'}>
                      {count}건 일괄 승인
                    </button>
                  </div>
                </>
              )}

              {phase === 'done' && result && (
                <>
                  <p role="status" className="batch-status">
                    <strong>{result.approved.length}건 승인했습니다.</strong>
                    {result.skipped.length > 0 && <strong className="field-error"> · {result.skipped.length}건은 건너뛰었습니다.</strong>}
                  </p>
                  {result.skipped.length > 0 && (
                    <>
                      <h3 className="sub-title">건너뛴 문의</h3>
                      <ul className="fail-list" aria-label="건너뛴 문의">
                        {result.skipped.map((s) => (
                          <li key={s.id}>
                            <span className="muted">문의 #{s.id}</span>
                            <span className="field-error"> — {s.reason}</span>
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
