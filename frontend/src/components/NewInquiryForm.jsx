import { useState } from 'react'
import { api } from '../api.js'

const MAX_LENGTH = 1000

// 시연용 새 문의 입력. 등록하면 바로 분류되고, 승인 대기가 될 문의에는 초안이 붙는다 (몇 초 걸림).
export default function NewInquiryForm({ onCreated, disabled }) {
  const [body, setBody] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!body.trim()) {
      setError('문의 내용을 입력하세요.')
      return
    }
    setSending(true)
    try {
      const created = await api.createInquiry(body)
      setBody('')
      onCreated(created)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <form className="new-inquiry" onSubmit={submit}>
      <label htmlFor="new-inquiry-body">새 문의 입력</label>
      <textarea
        id="new-inquiry-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        placeholder="시연용 문의를 입력하세요"
        disabled={sending || disabled}
      />
      <div className="new-inquiry-foot">
        <span className={`counter ${body.length > MAX_LENGTH ? 'over' : ''}`}>
          {body.length} / {MAX_LENGTH}
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
    </form>
  )
}
