import { useEffect, useState } from 'react'
import { classificationText, formatTime } from '../format.js'
import EvidenceList from './EvidenceList.jsx'
import { StatusBadge } from './InquiryList.jsx'
import ReplyEditor from './ReplyEditor.jsx'
import RiskWarnings from './RiskWarnings.jsx'

// 한 문의를 한 화면에서 처리한다: 문의 내용, 분류 결과, 초안, 근거, 버튼.
// 어떤 버튼을 보여줄지는 서버가 알려 준 detail.actions를 그대로 따른다.
export default function InquiryDetail({ detail, busyText, handlers }) {
  const [editing, setEditing] = useState(false)

  // 다른 문의를 열거나 문의가 처리되어 version이 바뀌면 고치던 상태를 닫는다
  useEffect(() => {
    setEditing(false)
  }, [detail.id, detail.version])

  const busy = Boolean(busyText)
  const can = (action) => detail.actions.includes(action)
  const draft = detail.current_draft
  const isSecondDraft = draft?.draft_no === 2

  return (
    <article className="detail" aria-label={`문의 ${detail.id}`}>
      <header className="detail-head">
        <h2>문의 #{detail.id}</h2>
        <StatusBadge status={detail.status} />
        {detail.asker && <span className="tag">{detail.asker} 문의</span>}
        <span className="muted">{formatTime(detail.created_at)}</span>
      </header>

      {busy && (
        <p className="busy" role="status">
          {busyText}
        </p>
      )}

      <section className="block">
        <h3>문의 내용</h3>
        <p className="body-text">{detail.body}</p>
      </section>

      <section className="block">
        <h3>분류 결과</h3>
        <p className="classification">{classificationText(detail)}</p>
        {detail.auto_note && (
          <div className="callout callout-info" role="note">
            {detail.auto_note}
          </div>
        )}
      </section>

      {detail.status === 'awaiting_approval' && draft && (
        <>
          <section className="block">
            <h3>{isSecondDraft ? '답장 초안 (재작성한 초안)' : '답장 초안'}</h3>
            {editing ? (
              <ReplyEditor
                initial={draft.content}
                submitLabel="저장"
                busy={busy}
                onSubmit={handlers.onEdit}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <>
                <p className="draft-text">{draft.content}</p>
                <RiskWarnings warnings={detail.risk_warnings} />
              </>
            )}
            {detail.drafts.length > 1 && (
              <details className="previous">
                <summary>첫 번째 초안 보기</summary>
                <p className="draft-text">{detail.drafts[0].content}</p>
              </details>
            )}
          </section>

          <EvidenceList evidence={detail.evidence} legacyOnly={detail.legacy_only} />

          {!editing && (
            <div className="button-row sticky">
              {can('approve') && (
                <button type="button" className="btn btn-primary" onClick={handlers.onApprove} disabled={busy}>
                  승인
                </button>
              )}
              {can('edit') && (
                <button type="button" className="btn" onClick={() => setEditing(true)} disabled={busy}>
                  수정
                </button>
              )}
              {can('rewrite') && (
                <button type="button" className="btn" onClick={handlers.onRewrite} disabled={busy}>
                  재작성
                </button>
              )}
              {can('handoff') && (
                <button type="button" className="btn" onClick={handlers.onHandoff} disabled={busy}>
                  직접 작성으로 넘기기
                </button>
              )}
            </div>
          )}
          <p className="hint">승인해도 답장은 고객에게 실제로 발송되지 않습니다.</p>
        </>
      )}

      {detail.status === 'manual' && (
        <section className="block">
          <h3>직접 작성</h3>
          <p className="hint">이 문의는 초안 없이 직접 답장을 써야 합니다.</p>
          <ReplyEditor
            submitLabel="등록"
            busy={busy}
            placeholder="고객에게 보낼 답장을 입력하세요"
            onSubmit={handlers.onManualReply}
          />
        </section>
      )}

      {detail.status === 'done' && (
        <>
          <section className="block">
            <h3>최종 답장</h3>
            {editing ? (
              <ReplyEditor
                initial={detail.final_reply ?? ''}
                submitLabel="저장"
                busy={busy}
                onSubmit={handlers.onEdit}
                onCancel={() => setEditing(false)}
              />
            ) : (
              <>
                <p className="draft-text">{detail.final_reply}</p>
                <RiskWarnings warnings={detail.risk_warnings} />
                <p className="muted">
                  처리: {detail.resolved_by_name} · {formatTime(detail.resolved_at)}
                </p>
              </>
            )}
          </section>

          <EvidenceList evidence={detail.evidence} legacyOnly={detail.legacy_only} />

          {!editing && can('reedit') && (
            <div className="button-row sticky">
              <button type="button" className="btn" onClick={() => setEditing(true)} disabled={busy}>
                다시 수정
              </button>
            </div>
          )}
        </>
      )}
    </article>
  )
}
