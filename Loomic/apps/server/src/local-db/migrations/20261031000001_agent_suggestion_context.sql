alter table agent_suggestions
  add column if not exists execution_mode text not null default 'automatic'
    check (execution_mode in ('automatic','isolated_browser','connected_browser_tab','windows_ui','visual_ocr')),
  add column if not exists output_kind text not null default 'auto'
    check (output_kind in ('auto','canvas','document','image','video','bundle'));
