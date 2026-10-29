alter table chat_messages add column if not exists client_message_id text;
create unique index if not exists chat_messages_session_client_message_idx on chat_messages(session_id, client_message_id);
