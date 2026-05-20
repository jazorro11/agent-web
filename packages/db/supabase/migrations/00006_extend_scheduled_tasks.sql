-- Extend scheduled_tasks table with metadata and retry fields
ALTER TABLE public.scheduled_tasks
ADD COLUMN name text NOT NULL DEFAULT '',
ADD COLUMN description text,
ADD COLUMN tags text[] DEFAULT ARRAY[]::text[],
ADD COLUMN priority text NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('low', 'medium', 'high')),
ADD COLUMN max_retries smallint NOT NULL DEFAULT 0
  CHECK (max_retries >= 0 AND max_retries <= 10);

-- Extend scheduled_task_runs table with retry tracking
ALTER TABLE public.scheduled_task_runs
ADD COLUMN attempt_number smallint NOT NULL DEFAULT 1,
ADD COLUMN retry_count smallint NOT NULL DEFAULT 0,
ADD COLUMN retry_reason text;

-- Index for priority-based ordering (when multiple tasks due at same time)
CREATE INDEX idx_scheduled_tasks_priority
ON public.scheduled_tasks(status, next_run_at, priority DESC)
WHERE status = 'active';

-- Index for finding failed runs that can be retried
CREATE INDEX idx_task_runs_pending_retry
ON public.scheduled_task_runs(task_id, status, retry_count)
WHERE status = 'failed';
