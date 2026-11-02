// 위험 표현 경고: 상담사가 약속하면 안 되는 말이 든 문장을 보여준다. 경고만 하고 막지는 않는다.
export default function RiskWarnings({ warnings }) {
  if (!warnings || warnings.length === 0) return null
  return (
    <div className="callout callout-warn" role="alert">
      <strong>위험 표현 경고</strong>
      <p className="callout-sub">상담사가 함부로 약속하면 안 되는 말이 들어 있습니다. 확인하고 진행하세요.</p>
      <ul className="warn-list">
        {warnings.map((warning) => (
          <li key={warning.sentence}>
            <mark>{warning.sentence}</mark>
            <span className="chips">
              {warning.phrases.map((phrase) => (
                <span className="chip" key={phrase}>
                  {phrase}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
