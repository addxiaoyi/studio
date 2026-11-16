alter table if exists project_user_contexts
  drop constraint if exists project_user_contexts_view_check;

alter table if exists project_user_contexts
  add constraint project_user_contexts_view_check
  check (view in ('canvas', 'workflow', 'timeline', 'video', 'conversation', 'fitting'));
