create index if not exists conversation_schedule_runs_current_stage_idx
  on public.conversation_schedule_runs (current_stage_id)
  where current_stage_id is not null;
