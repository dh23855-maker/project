import { useState } from 'react'
import { api } from '../api.js'
import RiskWarnings from './RiskWarnings.jsx'

// 답장을 쓰거나 고치는 칸.
// 저장 전에 위험 표현을 검사해서 경고가 있으면 문장을 보여주고, 상담사가 확인하면 그대로 저장한다 (막지 않음).
export default function ReplyEditor({ initial = '', submitLabel, onSubmit, onCancel, busy, placeholder }) {
  const [text, setText] = useState(initial)
  const [warnings, setWarnings] = useState([])
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)

  const working = busy || checking

  function change(event) {
    setText(event.target.value)
    setWarnings([]) // 글을 고치면 이전 경고는 더 이상 맞지 않는다
    setError('')
  }

  async function submit() {
    setError('')
    if (!text.trim()) {
      setError('답장 내용을 입력하세요.')
      return
    }
    setChecking(true)
    let found = []
    try {
      found = (await api.riskCheck(text)).warnings
    } catch (e) {
      setError(e.message)
      setChecking(false)
      return
    }
    setChecking(false)
    if (found.length > 0) {
      setWarnings(found)
      return
    }
    await onSubmit(text)
  }

  async function confirm() {
    await onSubmit(text)
  }

  return (
    <div className="editor">
      <textarea
        value={text}
        onChange={change}
        rows={8}
        placeholder={placeholder}
        aria-label="답장 내용"
        disabled={working}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <RiskWarnings warnings={warnings} />
      <div className="button-row">
        {warnings.length > 0 ? (
          <>
            <button type="button" className="btn btn-danger" onClick={confirm} disabled={working}>
              그래도 {submitLabel}
            </button>
            <button type="button" className="btn" onClick={() => setWarnings([])} disabled={working}>
              계속 고치기
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-primary" onClick={submit} disabled={working}>
            {checking ? '확인하는 중...' : submitLabel}
          </button>
        )}
        {onCancel && warnings.length === 0 && (
          <button type="button" className="btn" onClick={onCancel} disabled={working}>
            취소
          </button>
        )}
      </div>
    </div>
  )
}
