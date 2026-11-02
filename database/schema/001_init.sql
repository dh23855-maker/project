-- 상담사 답변 도우미: 처음 표 설계
-- 모든 표에 접근 제한(RLS)을 켠다. 서버는 DB 소유자 계정으로 접속하므로 그대로 읽고 쓰고,
-- Supabase가 외부에 열어 두는 API(anon/authenticated)는 정책이 없어서 아무것도 못 본다.

-- 상담사 (김상담, 박상담, 이상담)
CREATE TABLE agents (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    username      text        NOT NULL UNIQUE,
    display_name  text        NOT NULL,
    password_hash text        NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- 문의
--   status: awaiting_approval(승인 대기) / manual(직접 작성) / done(처리 완료)
--   version: 두 상담사가 동시에 처리할 때 먼저 저장한 쪽만 적용하기 위한 번호
CREATE TABLE inquiries (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    body             text        NOT NULL
                     CHECK (char_length(btrim(body)) > 0 AND char_length(body) <= 1000),
    status           text        NOT NULL
                     CHECK (status IN ('awaiting_approval', 'manual', 'done')),
    predicted_label  text
                     CHECK (predicted_label IN (
                         'buyer_delivery', 'buyer_inspection_result', 'buyer_cancel_refund',
                         'buyer_payment', 'seller_inspection_fail', 'seller_penalty',
                         'seller_settlement')),
    confidence       real        CHECK (confidence >= 0 AND confidence <= 1),
    auto_note        text,
    rewrite_count    smallint    NOT NULL DEFAULT 0 CHECK (rewrite_count BETWEEN 0 AND 1),
    final_reply      text,
    resolved_by      bigint      REFERENCES agents (id),
    resolved_at      timestamptz,
    source           text        NOT NULL DEFAULT 'user' CHECK (source IN ('seed', 'user')),
    created_by       bigint      REFERENCES agents (id),
    version          integer     NOT NULL DEFAULT 0,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inquiries_created_idx ON inquiries (created_at DESC, id DESC);
CREATE INDEX inquiries_status_idx  ON inquiries (status);

-- 답장 초안 (문의당 최대 2개: 처음 초안, 재작성한 초안)
CREATE TABLE drafts (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inquiry_id     bigint      NOT NULL REFERENCES inquiries (id) ON DELETE CASCADE,
    draft_no       smallint    NOT NULL CHECK (draft_no IN (1, 2)),
    content        text        NOT NULL,
    cited_articles jsonb       NOT NULL DEFAULT '[]'::jsonb,
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (inquiry_id, draft_no)
);

-- 작업 기록 (승인 / 수정 / 재작성 / 직접 작성)
--   재작성: draft_text = 재작성 전 초안, new_draft_text = 새 초안
--   승인·수정: draft_text = 초안, final_reply = 최종 답장
--   직접 작성: final_reply = 최종 답장
CREATE TABLE action_logs (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    inquiry_id     bigint      NOT NULL REFERENCES inquiries (id) ON DELETE CASCADE,
    agent_id       bigint      NOT NULL REFERENCES agents (id),
    action         text        NOT NULL
                   CHECK (action IN ('approve', 'edit', 'rewrite', 'manual_write')),
    draft_text     text,
    new_draft_text text,
    final_reply    text,
    created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX action_logs_created_idx ON action_logs (created_at DESC, id DESC);
CREATE INDEX action_logs_agent_idx   ON action_logs (agent_id);
CREATE INDEX action_logs_action_idx  ON action_logs (action);

-- 위험 표현 목록 (추가만 가능)
CREATE TABLE risky_phrases (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    phrase     text        NOT NULL CHECK (char_length(btrim(phrase)) > 0),
    created_by bigint      REFERENCES agents (id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX risky_phrases_phrase_uidx ON risky_phrases (btrim(phrase));

-- 설정 (confidence_threshold: 기준값 %, 처음 70)
CREATE TABLE settings (
    key        text PRIMARY KEY,
    value      text        NOT NULL,
    updated_by bigint      REFERENCES agents (id),
    updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO settings (key, value) VALUES ('confidence_threshold', '70');

-- 성능 평가 실행 결과 (실행할 때마다 한 줄)
CREATE TABLE eval_runs (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    run_by     bigint      REFERENCES agents (id),
    result     jsonb       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE agents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE inquiries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_logs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE risky_phrases ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings      ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_runs     ENABLE ROW LEVEL SECURITY;
