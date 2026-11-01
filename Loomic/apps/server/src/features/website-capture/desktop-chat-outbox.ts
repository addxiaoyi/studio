import type { Pool } from "pg";

export async function deliverDesktopChatOutbox(db: Pick<Pool, "query">) {
  const delivered = await db.query<{ task_id: string }>(
    `with pending as materialized (
       select o.* from desktop_agent_chat_outbox o
       join chat_sessions cs on cs.id=o.session_id and cs.created_by=o.user_id
       where o.delivered_at is null order by o.created_at
       limit 50 for update of o skip locked
     ), inserted as (
       insert into chat_messages(session_id,role,content,content_blocks,client_message_id)
       select session_id,'assistant','',jsonb_build_array(jsonb_build_object(
         'type','tool','toolCallId','desktop-agent:' || task_id::text,
         'toolName','desktop_control','status','completed','input',jsonb_build_object('goal',goal),
         'output',jsonb_strip_nulls(jsonb_build_object('taskId',task_id,'status',status,'summary',summary)),
         'outputSummary','Desktop Agent task ' || status
       )), 'desktop-agent:' || task_id::text || ':' || status from pending
       on conflict (session_id,client_message_id) do nothing returning id
     ), marked as (
       update desktop_agent_chat_outbox o set delivered_at=now()
       from pending p, (select count(*) from inserted) done
       where o.task_id=p.task_id and o.status=p.status returning o.task_id
     ) select task_id from marked`,
  );
  return delivered.rows.length;
}
