import { Fragment, useEffect, useState } from 'react'
import { api } from '../api.js'
import { ACTION_LABEL, formatTime, snippet } from '../format.js'

// 연습용 상담사 계정 (spec: 3명)
const AGENTS = [
  { username: 'kim', name: '김상담' },
  { username: 'park', name: '박상담' },
  { username: 'lee', name: '이상담' },
]

// 작업 기록: 누가, 언제, 무엇을 했는지. 상담사와 행동으로 거를 수 있다.
export default function LogsPage() {
  const [agent, setAgent] = useState('')
  const [action, setAction] = useState('')
  const [rows, setRows] = useState([])
  const [state, setState] = useState('loading')
  const [error, setError] = useState('')
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    api
      .listLogs({ agent, action })
      .then((result) => {
        if (cancelled) return
        setRows(result)
        setState('ready')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message)
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [agent, action])

  return (
    <div className="page">
      <h1>작업 기록</h1>
      <div className="filters">
        <label>
          상담사
          <select value={agent} onChange={(e) => setAgent(e.target.value)}>
            <option value="">전체</option>
            {AGENTS.map((a) => (
              <option key={a.username} value={a.username}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          행동
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">전체</option>
            {Object.entries(ACTION_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {state === 'loading' && <p className="muted">불러오는 중...</p>}
      {state === 'error' && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {state === 'ready' && rows.length === 0 && <p className="muted">기록이 없습니다.</p>}
      {state === 'ready' && rows.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>시간</th>
              <th>상담사</th>
              <th className="col-action">행동</th>
              <th>문의</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr>
                  <td>{formatTime(row.created_at)}</td>
                  <td>{row.agent_name}</td>
                  <td>
                    <span className={`tag action-${row.action}`}>{row.action_ko}</span>
                  </td>
                  <td>
                    #{row.inquiry_id} {snippet(row.inquiry_body, 40)}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => setOpenId(openId === row.id ? null : row.id)}
                      aria-expanded={openId === row.id}
                    >
                      {openId === row.id ? '접기' : '자세히'}
                    </button>
                  </td>
                </tr>
                {openId === row.id && (
                  <tr className="log-detail">
                    <td colSpan={5}>
                      {row.draft_text && (
                        <div className="log-block log-block-draft">
                          <strong>{row.action === 'rewrite' ? '재작성 전 초안' : '초안'}</strong>
                          <p className="draft-text">{row.draft_text}</p>
                        </div>
                      )}
                      {row.new_draft_text && (
                        <div className="log-block log-block-new">
                          <strong>새 초안</strong>
                          <p className="draft-text">{row.new_draft_text}</p>
                        </div>
                      )}
                      {row.final_reply && (
                        <div className="log-block log-block-final">
                          <strong>최종 답장</strong>
                          <p className="draft-text">{row.final_reply}</p>
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
