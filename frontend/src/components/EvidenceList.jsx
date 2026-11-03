// 초안의 근거가 된 규정 문서의 번호와 원문. 근거가 구버전 기준뿐이면 경고를 함께 보여준다.
// 조항에 없는 내용이 있으면(uncoveredNote) '규정 문서에는 없음'을 함께 띄운다. 규정 문서가 하나도 없는 초안도 마찬가지다.
export default function EvidenceList({ evidence, legacyOnly, uncoveredNote }) {
  const hasEvidence = Boolean(evidence && evidence.length > 0)
  if (!hasEvidence && !uncoveredNote) return null
  return (
    <section className="block" aria-label="규정 문서">
      <h3>규정 문서</h3>
      {legacyOnly && (
        <div className="callout callout-legacy" role="note">
          구버전 기준이라 현재와 다를 수 있음
        </div>
      )}
      {hasEvidence && (
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
      )}
      {uncoveredNote && (
        <div className="callout callout-warn" role="note" data-testid="uncovered">
          <strong>규정 문서에는 없음</strong>
          <p className="callout-sub">{uncoveredNote}</p>
          <p className="callout-sub">이 부분은 정책에서 확인되지 않았으니 승인 전에 직접 확인해 주세요.</p>
        </div>
      )}
    </section>
  )
}
