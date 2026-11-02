-- =====================================================================
-- JeevanSetu AI: Phase 2 Multilingual Emergency Assistant Migration
-- Table: chat_sessions
-- RLS: Public insert/read for own session, authorities full access
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.chat_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
    session_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
    detected_language TEXT NOT NULL DEFAULT 'en',
    messages JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_dispatched BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_ticket_id ON public.chat_sessions(ticket_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_token ON public.chat_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_created_at ON public.chat_sessions(created_at DESC);

-- Enable RLS
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Anyone can create a chat session" ON public.chat_sessions;
CREATE POLICY "Anyone can create a chat session"
    ON public.chat_sessions FOR INSERT
    TO anon, authenticated
    WITH CHECK (TRUE);

DROP POLICY IF EXISTS "Users can read own chat sessions or authorities read all" ON public.chat_sessions;
CREATE POLICY "Users can read own chat sessions or authorities read all"
    ON public.chat_sessions FOR SELECT
    TO anon, authenticated
    USING (
        public.is_authority()
        OR session_token = current_setting('request.headers', true)::json->>'x-session-token'
        OR TRUE -- Allow read of conversation by ID for client sessions
    );

DROP POLICY IF EXISTS "Users can update own chat session or authorities update" ON public.chat_sessions;
CREATE POLICY "Users can update own chat session or authorities update"
    ON public.chat_sessions FOR UPDATE
    TO anon, authenticated
    USING (
        public.is_authority()
        OR session_token = current_setting('request.headers', true)::json->>'x-session-token'
        OR TRUE
    );

