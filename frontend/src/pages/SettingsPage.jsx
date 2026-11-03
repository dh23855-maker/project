import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatTime } from '../format.js'

// 설정 화면: 기준값(확신도가 이 값보다 낮으면 경고)과 위험 표현 목록.
export default function SettingsPage() {
  const [settings, setSettings] = useState(null)
  const [thresholdText, setThresholdText] = useState('')
  const [thresholdMsg, setThresholdMsg] = useState(null) // { kind, text }
  const [phrases, setPhrases] = useState([])
  const [phraseText, setPhraseText] = useState('')
  const [phraseMsg, setPhraseMsg] = useState(null)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    Promise.all([api.getSettings(), api.listPhrases()])
      .then(([s, p]) => {
        setSettings(s)
        setThresholdText(String(s.confidence_threshold))
        setPhrases(p)
      })
      .catch((e) => setLoadError(e.message))
  }, [])

  async function saveThreshold(event) {
    event.preventDefault()
    setThresholdMsg(null)
    const trimmed = thresholdText.trim()
    // 비어 있으면 null을 보내서 서버의 안내 문구를 그대로 보여준다
    const value = trimmed === '' ? null : Number(trimmed)
    try {
      const saved = await api.putThreshold(Number.isNaN(value) ? trimmed : value)
      setSettings(saved)
      setThresholdText(String(saved.confidence_threshold))
      setThresholdMsg({ kind: 'success', text: `기준값을 ${saved.confidence_threshold}%로 저장했습니다. 새로 들어오는 문의부터 적용됩니다.` })
    } catch (e) {
      setThresholdMsg({ kind: 'error', text: e.message })
    }
  }

  async function addPhrase(event) {
    event.preventDefault()
    setPhraseMsg(null)
    try {
      const list = await api.addPhrase(phraseText)
      setPhrases(list)
      setPhraseText('')
      setPhraseMsg({ kind: 'success', text: '위험 표현을 추가했습니다.' })
    } catch (e) {
      setPhraseMsg({ kind: 'error', text: e.message })
    }
  }

  if (loadError) {
    return (
      <div className="page">
        <p className="field-error" role="alert">
          {loadError}
        </p>
      </div>
    )
  }
  if (!settings) {
    return (
      <div className="page">
        <p className="muted">불러오는 중...</p>
      </div>
    )
  }

  return (
    <div className="page">
      <h1>설정</h1>

      <section className="card">
        <h2>기준값</h2>
        <p className="muted">
          분류 확신도가 이 값보다 낮은 문의에는 초안과 함께 &quot;분류 확신도가 낮음&quot; 경고가 뜹니다. 낮아도 초안은 만듭니다.
          저장한 뒤 새로 들어오는 문의부터 적용되고 이미 있는 문의는 바뀌지 않습니다.
        </p>
        <form className="inline-form" onSubmit={saveThreshold} noValidate>
          <label htmlFor="threshold">확신도 기준값 (%)</label>
          <input
            id="threshold"
            inputMode="numeric"
            value={thresholdText}
            onChange={(e) => setThresholdText(e.target.value)}
          />
          <button type="submit" className="btn btn-primary">
            저장
          </button>
          <span className="muted">
            {settings.min}~{settings.max} 사이의 정수
          </span>
        </form>
        {thresholdMsg && (
          <p className={thresholdMsg.kind === 'error' ? 'field-error' : 'field-ok'} role={thresholdMsg.kind === 'error' ? 'alert' : 'status'}>
            {thresholdMsg.text}
          </p>
        )}
      </section>

      <section className="card">
        <h2>위험 표현 목록</h2>
        <p className="muted">
          답장에 이 말이 들어 있으면 경고가 뜹니다 (띄어쓰기는 무시). 경고만 하고 저장은 막지 않습니다. 추가만 할 수 있습니다.
        </p>
        <form className="inline-form" onSubmit={addPhrase} noValidate>
          <label htmlFor="phrase">새 위험 표현</label>
          <input id="phrase" value={phraseText} onChange={(e) => setPhraseText(e.target.value)} />
          <button type="submit" className="btn btn-primary">
            추가
          </button>
        </form>
        {phraseMsg && (
          <p className={phraseMsg.kind === 'error' ? 'field-error' : 'field-ok'} role={phraseMsg.kind === 'error' ? 'alert' : 'status'}>
            {phraseMsg.text}
          </p>
        )}
        <p className="muted">총 {phrases.length}개</p>
        <ul className="phrase-list">
          {phrases.map((phrase) => (
            <li key={phrase.id} title={`${phrase.created_by_name ?? '처음 목록'} · ${formatTime(phrase.created_at)}`}>
              {phrase.phrase}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
