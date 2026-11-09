import { useState } from 'react'
import { api } from '../api.js'

const MAX_LENGTH = 1000

// 시연용 새 문의 입력. 등록하면 바로 분류되고, 승인 대기가 될 문의에는 초안이 붙는다 (몇 초 걸림).
// 제목을 누르면 입력 칸이 접히고 펼쳐진다. 접어 둬도 쓰던 글은 그대로 남는다.
export default function NewInquiryForm({ onCreated, disabled, headerExtra = null }) {
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const [open, setOpen] = useState(true)

  async function submit(event) {
    event?.preventDefault()
    if (sending || disabled) return
    setError('')
    if (!body.trim()) {
      setError('문의 내용을 입력하세요.')
      setOpen(true)
      return
    }
    setSending(true)
    try {
      const created = await api.createInquiry(body)
      setBody('')
      onCreated(created)
    } catch (e) {
      setError(e.message)
      setOpen(true) // 접어 둔 채로 실패하면 안내가 안 보이므로 펼친다
    } finally {
      setSending(false)
    }
  }

  // 엔터: 등록, Shift+엔터: 줄바꿈. 한글을 입력하는 중(글자 조합 중)에 누른 엔터는 등록으로 보지 않는다.
  function onKeyDown(event) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    submit()
  }

  return (
    <form className="new-inquiry" onSubmit={submit}>
      <div className="new-inquiry-head">
        <button
          type="button"
          className="new-inquiry-toggle"
          aria-expanded={open}
          aria-controls="new-inquiry-panel"
          onClick={() => setOpen((value) => !value)}
        >
          새 문의 입력
          <svg className="new-inquiry-chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        {headerExtra}
      </div>
      <div id="new-inquiry-panel" className={`new-inquiry-panel ${open ? '' : 'collapsed'}`} inert={!open}>
        <div className="new-inquiry-panel-inner">
          <textarea
            id="new-inquiry-body"
            aria-label="새 문의 입력"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={onKeyDown}
            rows={3}
            placeholder="문의를 입력하세요"
            disabled={sending || disabled}
          />
          <div className="new-inquiry-foot">
            <span className={`counter ${body.length > MAX_LENGTH ? 'over' : ''}`}>
              {body.length} / {MAX_LENGTH}
              <span className="key-hint"> · Enter 등록 · Shift+Enter 줄바꿈</span>
            </span>
            <button type="submit" className="btn btn-primary" disabled={sending || disabled}>
              {sending ? '분류하고 초안 만드는 중...' : '등록'}
            </button>
          </div>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </form>
  )
}
