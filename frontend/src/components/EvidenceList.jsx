// 초안의 근거가 된 정책 조항의 번호와 원문. 근거가 구버전 기준뿐이면 경고를 함께 보여준다.
export default function EvidenceList({ evidence, legacyOnly }) {
  if (!evidence || evidence.length === 0) return null
  return (
    <section className="block" aria-label="근거 조항">
      <h3>근거 조항</h3>
      {legacyOnly && (
        <div className="callout callout-legacy" role="note">
          구버전 기준이라 현재와 다를 수 있음
        </div>
      )}
      <ul className="evidence">
        {evidence.map((clause) => (
          <li key={clause.id}>
            <details open>
              <summary>
                <span className="clause-id">[{clause.id}]</span> {clause.title}
                <span className={`tag ${clause.legacy ? 'tag-legacy' : ''}`}>{clause.label}</span>
              </summary>
              <pre className="clause-body">{clause.content}</pre>
            </details>
          </li>
        ))}
      </ul>
    </section>
  )
}
