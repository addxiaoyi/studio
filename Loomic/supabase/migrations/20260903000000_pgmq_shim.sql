-- PGMQ 兼容层 (Shim) - 用普通表 + SKIP LOCKED 模拟 PGMQ 队列
-- 这是为了在没有 pgmq 扩展的本地 PostgreSQL 上运行 Helstera
-- 仅实现了 Helstera 用到的子集: send / read / read_with_poll / delete / archive / set_vt

-- ── 队列元数据表 ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pgmq_queues (
  queue_name text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── 消息表（按队列分区） ─────────────────────────────────────────
-- 简化版：单表 + queue_name 字段。所有 Helstera 队列共用此表
CREATE TABLE IF NOT EXISTS pgmq_messages (
  msg_id        bigserial PRIMARY KEY,
  queue_name    text NOT NULL,
  message       jsonb NOT NULL,
  vt            timestamptz NOT NULL DEFAULT now(),
  read_ct       integer NOT NULL DEFAULT 0,
  enqueued_at   timestamptz NOT NULL DEFAULT now(),
  archived_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_pgmq_messages_queue_vt
  ON pgmq_messages (queue_name, vt)
  WHERE archived_at IS NULL;

-- ── 创建队列（幂等） ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION pgmq_create(qname text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO pgmq_queues (queue_name) VALUES (qname)
  ON CONFLICT (queue_name) DO NOTHING;
END;
$$;

-- 提供 pgmq.create 函数名（兼容项目代码中的调用）
CREATE OR REPLACE FUNCTION pgmq_create_fn(qname text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pgmq_create(qname);
END;
$$;

-- pgmq.create 实际是函数不是 schema
CREATE SCHEMA IF NOT EXISTS pgmq;

CREATE OR REPLACE FUNCTION pgmq.create(qname text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pgmq_create(qname);
END;
$$;

-- ── 发送消息（兼容 pgmq.send 返回值：bigint msg_id） ───────────
CREATE OR REPLACE FUNCTION pgmq.send(qname text, payload jsonb, delay_secs integer DEFAULT 0)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  new_id bigint;
  vt_time timestamptz;
BEGIN
  -- 跳过空 payload
  IF payload IS NULL THEN
    payload := '{}'::jsonb;
  END IF;

  IF delay_secs > 0 THEN
    vt_time := now() + (delay_secs || ' seconds')::interval;
  ELSE
    vt_time := now();
  END IF;

  INSERT INTO pgmq_messages (queue_name, message, vt)
  VALUES (qname, payload, vt_time)
  RETURNING msg_id INTO new_id;

  RETURN new_id;
END;
$$;

-- 让 SELECT * FROM pgmq.send(...) 也工作（项目代码中实际是这样调用）
-- pgmq.send 返回 bigint，SELECT 包裹时会作为一行返回
DROP FUNCTION IF EXISTS pgmq.send_with_row(text, jsonb, integer);
CREATE OR REPLACE FUNCTION pgmq.send_with_row(qname text, payload jsonb, delay_secs integer DEFAULT 0)
RETURNS TABLE(send bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  new_id bigint;
BEGIN
  new_id := pgmq.send(qname, payload, delay_secs);
  RETURN QUERY SELECT new_id;
END;
$$;

-- pgmq.send 在项目代码中被这样调用：
--   SELECT * FROM pgmq.send($1::text, $2::jsonb, $3::integer)
-- 返回单行单列 "send" bigint
-- 因此需要覆写 pgmq.send 为 TABLE 返回类型
DROP FUNCTION IF EXISTS pgmq.send(text, jsonb, integer);
CREATE OR REPLACE FUNCTION pgmq.send(qname text, payload jsonb, delay_secs integer DEFAULT 0)
RETURNS TABLE(send bigint)
LANGUAGE plpgsql
AS $$
DECLARE
  new_id bigint;
BEGIN
  new_id := pgmq_insert(qname, payload, delay_secs);
  RETURN QUERY SELECT new_id;
END;
$$;

-- 内部纯函数：返回 msg_id
CREATE OR REPLACE FUNCTION pgmq_insert(qname text, payload jsonb, delay_secs integer DEFAULT 0)
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  new_id bigint;
  vt_time timestamptz;
BEGIN
  IF payload IS NULL THEN payload := '{}'::jsonb; END IF;
  IF delay_secs > 0 THEN
    vt_time := now() + (delay_secs || ' seconds')::interval;
  ELSE
    vt_time := now();
  END IF;
  INSERT INTO pgmq_messages (queue_name, message, vt)
  VALUES (qname, payload, vt_time)
  RETURNING msg_id INTO new_id;
  RETURN new_id;
END;
$$;

-- ── 读取消息（带 vt 过期判断） ──────────────────────────────────
-- pgmq.read 返回多行（最多 qty 条），每行包含 msg_id, read_ct, enqueued_at, vt, message
-- 同时更新 vt = now() + vt_secs
CREATE OR REPLACE FUNCTION pgmq.read(qname text, vt_secs integer, qty integer)
RETURNS TABLE(msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  WITH locked AS (
    SELECT m.msg_id
    FROM pgmq_messages m
    WHERE m.queue_name = qname
      AND m.archived_at IS NULL
      AND m.vt <= now()
    ORDER BY m.msg_id
    LIMIT qty
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE pgmq_messages m
    SET vt = now() + (vt_secs || ' seconds')::interval,
        read_ct = m.read_ct + 1
    FROM locked l
    WHERE m.msg_id = l.msg_id
    RETURNING m.msg_id, m.read_ct, m.enqueued_at, m.vt, m.message
  )
  SELECT u.msg_id, u.read_ct, u.enqueued_at, u.vt, u.message FROM updated u
  ORDER BY u.msg_id;
END;
$$;

-- ── 长轮询读取（read_with_poll） ───────────────────────────────
-- 项目代码:
--   SELECT * FROM pgmq.read_with_poll($1::text, $2::integer, $3::integer, $4::integer, $5::integer)
-- 参数: (queue, vt_secs, qty, max_poll_secs, poll_interval_ms)
-- 如果没有立即可读消息，按 poll_interval_ms 间隔重试，最长 max_poll_secs
CREATE OR REPLACE FUNCTION pgmq.read_with_poll(
  qname text,
  vt_secs integer,
  qty integer,
  max_poll_secs integer DEFAULT 5,
  poll_interval_ms integer DEFAULT 500
)
RETURNS TABLE(msg_id bigint, read_ct integer, enqueued_at timestamptz, vt timestamptz, message jsonb)
LANGUAGE plpgsql
AS $$
DECLARE
  start_time timestamptz := now();
  end_time   timestamptz := start_time + (max_poll_secs || ' seconds')::interval;
  sleep_dur  interval;
  result_count integer;
BEGIN
  -- 每次 sleep 时间（毫秒转 interval）
  sleep_dur := (poll_interval_ms || ' milliseconds')::interval;

  LOOP
    -- 尝试读取
    RETURN QUERY
    SELECT * FROM pgmq.read(qname, vt_secs, qty);

    -- 检查是否拿到了消息
    GET DIAGNOSTICS result_count = ROW_COUNT;
    IF result_count > 0 THEN
      RETURN;
    END IF;

    -- 超过最大轮询时间？
    IF now() >= end_time THEN
      RETURN;
    END IF;

    -- 睡一会儿再试
    PERFORM pg_sleep(LEAST(EXTRACT(EPOCH FROM (end_time - now())), EXTRACT(EPOCH FROM sleep_dur)));
  END LOOP;
END;
$$;

-- ── 删除消息（pgmq.delete 返回 boolean） ───────────────────────
CREATE OR REPLACE FUNCTION pgmq.delete(qname text, m_id bigint)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM pgmq_messages
  WHERE queue_name = qname AND msg_id = m_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count > 0;
END;
$$;

-- ── 归档消息（pgmq.archive 返回 boolean） ──────────────────────
CREATE OR REPLACE FUNCTION pgmq.archive(qname text, m_id bigint)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
  updated_count integer;
BEGIN
  UPDATE pgmq_messages
  SET archived_at = now()
  WHERE queue_name = qname AND msg_id = m_id AND archived_at IS NULL;
  GET DIAGNOSTICS updated_count = ROW_COUNT;
  RETURN updated_count > 0;
END;
$$;

-- ── 设置可见性超时（pgmq.set_vt） ─────────────────────────────
CREATE OR REPLACE FUNCTION pgmq.set_vt(qname text, m_id bigint, vt_secs integer)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE pgmq_messages
  SET vt = now() + (vt_secs || ' seconds')::interval
  WHERE queue_name = qname AND msg_id = m_id;
END;
$$;

-- ── 预创建 Helstera 所需的队列 ───────────────────────────────────
SELECT pgmq.create('image_generation_jobs');
SELECT pgmq.create('video_generation_jobs');
SELECT pgmq.create('code_execution_jobs');
