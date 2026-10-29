-- Chat message idempotency.
-- Clients now send a stable `client_message_id` per logical message so retries,
-- route reloads, and reconnect re-sends cannot insert duplicate rows.
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS client_message_id text;

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_session_client_message_idx
  ON public.chat_messages(session_id, client_message_id);
