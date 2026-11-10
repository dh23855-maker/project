import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'

export default function LoginPage() {
  const { agent, ready, login, connectionError } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)

  if (ready && agent) return <Navigate to="/" replace />

  async function submit(event) {
    event.preventDefault()
    setError('')
    setSending(true)
    try {
      await login(username, password)
    } catch (e) {
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit} noValidate>
        <h1>CSFlow</h1>
        <p className="muted">상담사 계정으로 로그인하세요.</p>

        <label htmlFor="username">아이디</label>
        <input
          id="username"
          autoComplete="username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />

        <label htmlFor="password">비밀번호</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {(error || connectionError) && (
          <p className="field-error" role="alert">
            {error || connectionError}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={sending}>
          {sending ? '확인하는 중...' : '로그인'}
        </button>
        <p className="hint">가상 시나리오용 연습 계정입니다. 모든 문의는 가짜 문의입니다.</p>
      </form>
    </div>
  )
}
