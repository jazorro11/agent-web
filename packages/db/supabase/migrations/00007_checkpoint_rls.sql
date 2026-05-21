-- Enable RLS on checkpoint tables
ALTER TABLE public.checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_blobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkpoint_writes ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read/write checkpoints for their own sessions only
-- Maps: checkpoint_*.thread_id → agent_sessions.id → agent_sessions.user_id
CREATE POLICY "Users can manage own session checkpoints"
  ON public.checkpoints
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.agent_sessions
      WHERE public.agent_sessions.id::text = public.checkpoints.thread_id
        AND public.agent_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own session checkpoint blobs"
  ON public.checkpoint_blobs
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.agent_sessions
      WHERE public.agent_sessions.id::text = public.checkpoint_blobs.thread_id
        AND public.agent_sessions.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can manage own session checkpoint writes"
  ON public.checkpoint_writes
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.agent_sessions
      WHERE public.agent_sessions.id::text = public.checkpoint_writes.thread_id
        AND public.agent_sessions.user_id = auth.uid()
    )
  );

-- checkpoint_migrations only has version (v) column, no thread_id
-- So it doesn't need a per-user policy; keep it accessible by schema
-- (or restrict based on system requirements in the future)
CREATE POLICY "checkpoint_migrations readonly"
  ON public.checkpoint_migrations
  FOR SELECT
  USING (true);
