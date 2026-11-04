import { useEffect, useState } from 'react'
import { api } from '../api.js'
import { formatTime } from '../format.js'

// 답장을 고치거나 직접 쓸 때 참고하라고 보여 주는 "비슷한 지난 문의": 처리 완료된 문의와 그 최종 답장.
// 편집 칸이 열릴 때만 불러온다. 못 불러와도 답장 쓰는 일은 막지 않는다.
export default function SimilarPast({ inquiryId }) {
  const [state, setState] = useState({ status: 'loading', items: [] })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading', items: [] })
    api
      .getSimilar(inquiryId)
      .then((result) => {
        if (!cancelled) setState({ status: 'ready', items: result.items })
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error', items: [] })
      })
    return () => {
      cancelled = true
    }
  }, [inquiryId])

  return (
    <section className="similar" aria-label="비슷한 지난 문의">
      <h4>비슷한 지난 문의</h4>
      <p className="hint">처리 완료된 문의 중 이 문의와 비슷한 것입니다. 답장을 쓸 때 참고하세요.</p>
      {state.status === 'loading' && <p className="muted">찾는 중...</p>}
      {state.status === 'error' && <p className="muted">비슷한 문의를 불러오지 못했습니다. 답장은 그대로 쓸 수 있습니다.</p>}
      {state.status === 'ready' && state.items.length === 0 && <p className="muted">비슷한 지난 문의가 없습니다.</p>}
      {state.items.length > 0 && (
        <ul className="similar-list">
          {state.items.map((item, index) => (
            <li key={item.id} className="similar-item">
              <div className="similar-head">
                {item.predicted_label_ko && <span className="tag">{item.predicted_label_ko}</span>}
                <span className="muted">
                  문의 #{item.id} · 비슷한 정도 {item.similarity_percent}%
                  {item.resolved_at ? ` · ${formatTime(item.resolved_at)}` : ''}
                </span>
              </div>
              <p className="similar-body">{item.body}</p>
              {/* 가장 비슷한 문의의 답장은 펼쳐 두고, 나머지는 눌러서 본다 */}
              <details open={index === 0}>
                <summary>최종 답장</summary>
                <p className="draft-text">{item.final_reply}</p>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
