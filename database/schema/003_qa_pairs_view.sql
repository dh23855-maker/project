-- 질문 - 최종 답변 쌍 보기 (qa_pairs)
-- 복사본 표가 아니라 보기(view)다. inquiries의 "처리 완료" 줄을 쌍으로 보여 줄 뿐이라 항상 최신이고,
-- 답장을 고쳐도 따로 갱신할 것이 없다. 처리 완료 문의 전부가 대상이다.
--   resolution : 지금 답장이 만들어진 방법 = 마지막 처리 행동 (approve 초안 그대로 승인 / edit 고쳐서 / manual_write 직접 작성)
--   answered_by, answered_at : 지금 답장을 마지막으로 저장한 상담사와 시각 ([다시 수정]하면 바뀐다)
--   asked_at : 문의가 들어온 시각
CREATE VIEW qa_pairs WITH (security_invoker = true) AS
SELECT
    i.id            AS inquiry_id,
    i.body          AS question,
    i.final_reply   AS answer,
    i.predicted_label,
    i.confidence,
    l.action        AS resolution,
    i.rewrite_count,
    a.display_name  AS answered_by,
    l.created_at    AS answered_at,
    i.created_at    AS asked_at,
    i.source
FROM inquiries i
LEFT JOIN LATERAL (
    SELECT agent_id, action, created_at FROM action_logs
    WHERE inquiry_id = i.id AND action IN ('approve', 'edit', 'manual_write')
    ORDER BY id DESC LIMIT 1
) l ON true
LEFT JOIN agents a ON a.id = l.agent_id
WHERE i.status = 'done' AND i.final_reply IS NOT NULL;

-- 보기는 기본적으로 표의 접근 제한(RLS)을 우회할 수 있다. security_invoker = true로 보는 사람의 권한을 따르게 했고,
-- Supabase가 외부에 열어 두는 역할(anon, authenticated)에는 권한도 회수해서 질문·답변이 외부 API로 보이지 않게 한다.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON qa_pairs FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON qa_pairs FROM authenticated';
    END IF;
END $$;
