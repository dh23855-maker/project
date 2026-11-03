-- 초안에서 정책 근거 조항에 없는 내용이 있을 때, 그 내용을 한 줄로 적어 두는 칸.
-- 비어 있으면(NULL) 초안이 근거 조항 안에서 모두 답했다는 뜻이다.
-- 근거 조항이 하나도 없는 초안(cited_articles = [])에는 항상 값이 들어간다.
ALTER TABLE drafts ADD COLUMN uncovered_note text;
