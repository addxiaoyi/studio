alter table desktop_agent_tasks
  add column if not exists canvas_id uuid references canvases(id) on delete set null,
  add column if not exists execution_mode text not null default 'automatic'
    check (execution_mode in ('automatic','isolated_browser','connected_browser_tab','windows_ui','visual_ocr')),
  add column if not exists planned_actions jsonb not null default '[]'::jsonb;

alter table generated_assets
  add column if not exists desktop_agent_task_id uuid references desktop_agent_tasks(id) on delete set null;

create index if not exists desktop_agent_tasks_canvas_idx
  on desktop_agent_tasks(canvas_id, created_at desc)
  where canvas_id is not null;

create index if not exists generated_assets_desktop_agent_task_idx
  on generated_assets(desktop_agent_task_id)
  where desktop_agent_task_id is not null;
