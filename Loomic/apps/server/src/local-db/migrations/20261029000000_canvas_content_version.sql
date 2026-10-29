-- 画布保存的乐观并发控制（OCC）。
--
-- 背景：`PUT /api/canvases/:canvasId` 是整段 content 的全量替换，没有版本号。
-- 两个标签页各自保存时后写覆盖前写，静默丢数据。
-- `version` 把这个保存变成 compare-and-swap：保存时带 If-Match 的版本，
-- 服务端只在版本一致时写入并 version + 1，否则返回 409 且不写库。
--
-- 幂等：`if not exists` 保证重复执行（schema.sql 已建表 / 迁移重跑）不会失败。
alter table canvases add column if not exists version integer not null default 1;

comment on column canvases.version is
  'Canvas content revision used for optimistic concurrency (ETag / If-Match). Incremented on every successful save.';
