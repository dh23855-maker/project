import { Fragment, useEffect, useState } from 'react'
import { api } from '../api.js'
import SelectMenu from '../components/SelectMenu.jsx'
import { ACTION_LABEL, formatTime, snippet } from '../format.js'

// 연습용 상담사 계정 (spec: 3명)
const AGENTS = [
  { username: 'kim', name: '김상담' },
  { username: 'park', name: '박상담' },
  { username: 'lee', name: '이상담' },
]
const AGENT_OPTIONS = [{ value: '', label: '전체' }, ...AGENTS.map((a) => ({ value: a.username, label: a.name }))]
// 행동 필터에는 "직접 작성"을 두지 않는다 (직접 작성한 기록은 "전체"에서 계속 보인다)
const ACTION_OPTIONS = [
  { value: '', label: '전체' },
  ...Object.entries(ACTION_LABEL)
    .filter(([value]) => value !== 'manual_write')
    .map(([value, label]) => ({ value, label })),
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
        <div className="filter">
          <span className="filter-label" aria-hidden="true">
            상담사
          </span>
          <SelectMenu label="상담사" value={agent} onChange={setAgent} options={AGENT_OPTIONS} />
        </div>
        <div className="filter">
          <span className="filter-label" aria-hidden="true">
            행동
          </span>
          <SelectMenu label="행동" value={action} onChange={setAction} options={ACTION_OPTIONS} />
        </div>
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
              <th className="nowrap">시간</th>
              <th className="nowrap">상담사</th>
              <th className="nowrap col-action">행동</th>
              <th>문의</th>
              <th className="nowrap" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <tr>
                  <td className="nowrap">{formatTime(row.created_at)}</td>
                  <td className="nowrap">{row.agent_name}</td>
                  <td className="nowrap">
                    <span className={`tag action-${row.action}`}>{row.action_ko}</span>
                  </td>
                  <td>
                    #{row.inquiry_id} {snippet(row.inquiry_body, 40)}
                  </td>
                  <td className="nowrap">
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
