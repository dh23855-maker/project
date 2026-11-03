import { useCallback, useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatTime } from '../format.js'

const DIFFICULTY_KO = { easy: '쉬움', medium: '보통', hard: '어려움' }

export const percent = (value) => (value == null ? '-' : `${(value * 100).toFixed(1)}%`)
const ratio = (stat) => `${stat.correct}/${stat.total}`

function Bar({ value }) {
  return (
    <span className="bar" aria-hidden="true">
      <span className="bar-fill" style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
    </span>
  )
}

function StatTable({ title, firstHeader = '종류', rows }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <table className="table">
        <thead>
          <tr>
            <th>{firstHeader}</th>
            <th>맞힌 수</th>
            <th>정확도</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td>{row.name}</td>
              <td>{row.stat.total === 0 ? '-' : ratio(row.stat)}</td>
              <td>{percent(row.stat.accuracy)}</td>
              <td>{row.stat.total === 0 ? null : <Bar value={row.stat.accuracy} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

// 선택한 평가 실행 한 번의 결과: 전체·종류별·난이도별 정확도, 헷갈린 부분, 틀린 문의
function RunResult({ run }) {
  const nameOf = Object.fromEntries(run.labels.map((l) => [l.key, l.ko]))
  const labelRows = run.labels.map((l) => ({ key: l.key, name: l.ko, stat: run.per_label[l.key] }))
  const difficultyRows = run.per_difficulty
    ? run.difficulties.map((d) => ({ key: d, name: DIFFICULTY_KO[d] ?? d, stat: run.per_difficulty[d] }))
    : null

  return (
    <div className="eval-result" aria-label={`평가 결과 ${run.id}`}>
      <section className="card eval-total">
        <h2>전체 정확도</h2>
        <p className="big-number">
          {run.total}개 중 {run.correct}개 <span className="muted">({percent(run.accuracy)})</span>
        </p>
        <p className="muted">
          {run.description} · 평가용 문의 {run.total}개 · 학습용 문의 {run.train_size}개
        </p>
        <p className="muted">
          실행: {run.run_by_name ?? '알 수 없음'} · {formatTime(run.created_at)}
        </p>
      </section>

      <StatTable title="종류별 정확도" rows={labelRows} />
      {difficultyRows && <StatTable title="난이도별 정확도" firstHeader="난이도" rows={difficultyRows} />}

      <section className="card">
        <h2>헷갈린 부분</h2>
        {run.confusions.length === 0 ? (
          <p className="muted">틀린 문의가 없습니다.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>실제 종류</th>
                <th>모델이 나눈 종류</th>
                <th>개수</th>
              </tr>
            </thead>
            <tbody>
              {run.confusions.map((c) => (
                <tr key={`${c.true}-${c.predicted}`}>
                  <td>{nameOf[c.true] ?? c.true}</td>
                  <td>{nameOf[c.predicted] ?? c.predicted}</td>
                  <td>{c.count}개</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {run.wrong.length > 0 && (
          <details className="previous">
            <summary>틀린 문의 {run.wrong.length}개 보기</summary>
            <ul className="wrong-list">
              {run.wrong.map((w, index) => (
                <li key={index}>
                  <p className="body-text">{w.text}</p>
                  <p className="muted">
                    실제 {nameOf[w.true] ?? w.true} → 모델 {nameOf[w.predicted] ?? w.predicted}
                    {w.confidence != null && ` (확신도 ${(w.confidence * 100).toFixed(1)}%)`}
                    {w.difficulty && ` · ${DIFFICULTY_KO[w.difficulty] ?? w.difficulty}`}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>
    </div>
  )
}

// 성능 평가 화면: [평가 실행]으로 분류 모델을 평가하고, 이전 실행 결과도 다시 본다.
export default function EvaluationPage() {
  const [runs, setRuns] = useState([])
  const [selected, setSelected] = useState(null)
  const [state, setState] = useState('loading') // loading | ready | error
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const openRun = useCallback(async (id) => {
    setError('')
    try {
      setSelected(await api.getEvaluation(id))
    } catch (e) {
      setError(e.message)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api
      .listEvaluations()
      .then(async (list) => {
        if (cancelled) return
        setRuns(list)
        setState('ready')
        if (list.length > 0) {
          const latest = await api.getEvaluation(list[0].id)
          if (!cancelled) setSelected(latest)
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message)
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function run() {
    setError('')
    setRunning(true)
    try {
      const result = await api.runEvaluation()
      setSelected(result)
      setRuns(await api.listEvaluations())
    } catch (e) {
      setError(e.message) // 실패하면 서버가 아무것도 저장하지 않으므로 화면도 그대로 둔다
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="page">
      <h1>성능 평가</h1>
      <p className="muted">
        정답을 미리 달아 둔 연습용 문의로, 지금 쓰는 분류 모델이 문의 종류를 얼마나 맞히는지 확인합니다.
        평가용 문의는 상담 화면의 문의 목록에 섞이지 않습니다.
      </p>

      <div className="eval-actions">
        <button type="button" className="btn btn-primary" onClick={run} disabled={running || state === 'loading'}>
          평가 실행
        </button>
        {running && (
          <span className="busy" role="status">
            평가하는 중...
          </span>
        )}
      </div>

      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}

      {state === 'loading' && <p className="muted">불러오는 중...</p>}
      {state === 'ready' && runs.length === 0 && !running && (
        <p className="muted">아직 평가한 기록이 없습니다. [평가 실행]을 눌러 보세요.</p>
      )}

      {selected && <RunResult run={selected} />}

      {runs.length > 0 && (
        <section className="card">
          <h2>이전 실행 결과</h2>
          <table className="table">
            <thead>
              <tr>
                <th>실행 시각</th>
                <th>실행한 상담사</th>
                <th>결과</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className={selected?.id === r.id ? 'row-selected' : ''}>
                  <td>{formatTime(r.created_at)}</td>
                  <td>{r.run_by_name ?? '-'}</td>
                  <td>
                    {r.correct}/{r.total} ({percent(r.accuracy)})
                  </td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-small"
                      onClick={() => openRun(r.id)}
                      aria-label={`${formatTime(r.created_at)} 결과 보기`}
                      disabled={selected?.id === r.id}
                    >
                      {selected?.id === r.id ? '보는 중' : '보기'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}
