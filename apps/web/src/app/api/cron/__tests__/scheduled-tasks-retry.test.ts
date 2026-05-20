import { test } from "node:test";
import { strict as assert } from "node:assert";
import type { ScheduledTask, ScheduledTaskRun } from "@agents/types";

// Mock tracking objects
const mockState = {
  taskRunCreations: [] as Array<{
    taskId: string;
    attemptNumber: number;
    retryCount: number;
    retryReason?: string;
  }>,
  taskRunCompletions: [] as Array<{
    runId: string;
    taskId: string;
    agentSessionId?: string;
    nextRunAt: string | null;
    newStatus: "completed" | "active";
    notified: boolean;
  }>,
  taskRunFailures: [] as Array<{
    runId: string;
    taskId: string;
    errorMessage: string;
    nextRunAt: string | null;
  }>,
  telegramNotifications: [] as Array<{
    userId: string;
    message: string;
  }>,
  runAgentCalls: [] as Array<{ sessionId: string; attempt: number }>,
  sessionCreations: [] as Array<{ userId: string; taskId: string }>,
};

// Mock implementation of createTaskRun
async function mockCreateTaskRun(
  db: unknown,
  params: {
    taskId: string;
    agentSessionId?: string;
    attemptNumber?: number;
    retryCount?: number;
    retryReason?: string;
  }
): Promise<ScheduledTaskRun> {
  const id = `run-${mockState.taskRunCreations.length + 1}`;
  mockState.taskRunCreations.push({
    taskId: params.taskId,
    attemptNumber: params.attemptNumber ?? 1,
    retryCount: params.retryCount ?? 0,
    retryReason: params.retryReason,
  });

  return {
    id,
    task_id: params.taskId,
    status: "running",
    started_at: new Date().toISOString(),
    agent_session_id: params.agentSessionId,
    notified: false,
    attempt_number: params.attemptNumber ?? 1,
    retry_count: params.retryCount ?? 0,
    retry_reason: params.retryReason,
  };
}

// Mock implementation of completeTaskRun
async function mockCompleteTaskRun(
  db: unknown,
  params: {
    runId: string;
    taskId: string;
    agentSessionId?: string;
    nextRunAt: string | null;
    newStatus: "completed" | "active";
    notified: boolean;
    notificationError?: string;
  }
): Promise<void> {
  mockState.taskRunCompletions.push({
    runId: params.runId,
    taskId: params.taskId,
    agentSessionId: params.agentSessionId,
    nextRunAt: params.nextRunAt,
    newStatus: params.newStatus,
    notified: params.notified,
  });
}

// Mock implementation of failTaskRun
async function mockFailTaskRun(
  db: unknown,
  params: {
    runId: string;
    taskId: string;
    errorMessage: string;
    nextRunAt: string | null;
  }
): Promise<void> {
  mockState.taskRunFailures.push({
    runId: params.runId,
    taskId: params.taskId,
    errorMessage: params.errorMessage,
    nextRunAt: params.nextRunAt,
  });
}

// Mock implementation of getOrCreateCronSession
async function mockGetOrCreateCronSession(
  db: unknown,
  userId: string,
  taskId: string
): Promise<string> {
  const sessionId = `session-${mockState.sessionCreations.length + 1}`;
  mockState.sessionCreations.push({ userId, taskId });
  return sessionId;
}

// Mock implementation of buildAgentContextForTask
async function mockBuildAgentContextForTask(db: unknown, userId: string, sessionId: string) {
  return {
    userId,
    sessionId,
    systemPrompt: "Test prompt",
    db,
    enabledTools: [],
    integrations: [],
    githubToken: undefined,
    googleToken: undefined,
  };
}

// Mock implementation of notifyUserViaTelegram
async function mockNotifyUserViaTelegram(
  db: unknown,
  userId: string,
  message: string
): Promise<{ notified: boolean; reason?: string }> {
  mockState.telegramNotifications.push({ userId, message });
  return { notified: true };
}

// Mock implementation of computeNextRunAt
function mockComputeNextRunAt(task: ScheduledTask): string | null {
  if (task.schedule_type === "one_time") return null;
  return new Date(Date.now() + 86400000).toISOString(); // +1 day
}

// Mock implementation of buildNotificationText
function mockBuildNotificationText(task: ScheduledTask, response: string): string {
  const scheduleLabel =
    task.schedule_type === "recurring" ? `[Tarea recurrente]` : `[Tarea programada]`;
  const preview = response.length > 2000 ? `${response.slice(0, 2000)}…` : response;
  return `${scheduleLabel}\n\n${preview}`;
}

// Test version of handleTaskWithRetry
async function handleTaskWithRetry(
  db: unknown,
  task: ScheduledTask,
  runAgentMock: () => Promise<{ response: string }>
): Promise<void> {
  const maxAttempts = task.max_retries + 1;
  let lastError: string = "";
  let lastSessionId: string | undefined;

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
    const retryCount = attemptNumber - 1;

    // Create task run for this attempt
    const run = await mockCreateTaskRun(db, {
      taskId: task.id,
      attemptNumber,
      retryCount,
      retryReason: retryCount > 0 ? lastError : undefined,
    });

    try {
      // Get or create session and build context
      lastSessionId = await mockGetOrCreateCronSession(db, task.user_id, task.id);
      const ctx = await mockBuildAgentContextForTask(db, task.user_id, lastSessionId);

      // Track the runAgent call
      mockState.runAgentCalls.push({ sessionId: lastSessionId, attempt: attemptNumber });

      // Execute agent
      const result = await runAgentMock();

      // Success path: complete the run and notify
      const nextRunAt = mockComputeNextRunAt(task);
      const newStatus = task.schedule_type === "one_time" ? "completed" : "active";

      const notificationText = mockBuildNotificationText(task, result.response);
      const { notified, reason } = await mockNotifyUserViaTelegram(db, task.user_id, notificationText);

      await mockCompleteTaskRun(db, {
        runId: run.id,
        taskId: task.id,
        agentSessionId: lastSessionId,
        nextRunAt: newStatus === "active" ? nextRunAt : null,
        newStatus,
        notified,
        notificationError: reason,
      });

      // Exit on success
      return;
    } catch (err) {
      lastError = String(err);

      // Check if more retries available
      if (attemptNumber < maxAttempts) {
        // Calculate exponential backoff delay
        const delayMs = Math.pow(2, attemptNumber - 1) * 1000;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      // No more retries: fail the task permanently
      const nextRunAt = mockComputeNextRunAt(task);

      // Build failure notification with retry info
      const taskName = task.name ? ` "${task.name}"` : "";
      const failureMessage = `Tarea${taskName} falló después de ${attemptNumber} intentos: ${lastError}`;
      const { notified, reason } = await mockNotifyUserViaTelegram(db, task.user_id, failureMessage);

      await mockFailTaskRun(db, {
        runId: run.id,
        taskId: task.id,
        errorMessage: lastError,
        nextRunAt,
      });

      // Exit after permanent failure
      return;
    }
  }
}

// Helper to create a mock task
function createMockTask(overrides?: Partial<ScheduledTask>): ScheduledTask {
  return {
    id: "task-1",
    user_id: "user-1",
    prompt: "Test task prompt",
    schedule_type: "recurring",
    cron_expr: "0 9 * * *",
    timezone: "UTC",
    status: "active",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    name: "Test Task",
    tags: [],
    priority: "medium",
    max_retries: 1,
    ...overrides,
  };
}

// Helper to reset mocks
function resetMocks() {
  mockState.taskRunCreations = [];
  mockState.taskRunCompletions = [];
  mockState.taskRunFailures = [];
  mockState.telegramNotifications = [];
  mockState.runAgentCalls = [];
  mockState.sessionCreations = [];
}

// ============================================================================
// TEST CASES
// ============================================================================

test("handleTaskWithRetry - success on first attempt", async () => {
  resetMocks();

  const mockDb = {} as unknown;
  const mockTask = createMockTask({ max_retries: 1 });

  let runAgentCalls = 0;
  const runAgentMock = async () => {
    runAgentCalls++;
    return { response: "Success response" };
  };

  await handleTaskWithRetry(mockDb, mockTask, runAgentMock);

  assert.equal(runAgentCalls, 1, "runAgent should be called once");
  assert.equal(
    mockState.taskRunCreations.length,
    1,
    "Should create 1 TaskRun (1 attempt)"
  );
  assert.equal(
    mockState.taskRunCompletions.length,
    1,
    "completeTaskRun should be called once"
  );
  assert.equal(mockState.taskRunFailures.length, 0, "No failures should be recorded");

  const creation = mockState.taskRunCreations[0];
  assert.equal(creation.attemptNumber, 1, "First attempt number should be 1");
  assert.equal(creation.retryCount, 0, "Retry count should be 0 on first attempt");
  assert.equal(creation.retryReason, undefined, "No retry reason on first attempt");
});

test("handleTaskWithRetry - failure then success (retry succeeds)", async () => {
  resetMocks();

  const mockDb = {} as unknown;
  const mockTask = createMockTask({ max_retries: 2 });

  let attempts = 0;
  const runAgentMock = async () => {
    attempts++;
    if (attempts === 1) {
      throw new Error("First attempt failed");
    }
    return { response: "Success after retry" };
  };

  const startTime = Date.now();
  await handleTaskWithRetry(mockDb, mockTask, runAgentMock);
  const elapsed = Date.now() - startTime;

  assert.equal(attempts, 2, "runAgent should be called twice (fail then success)");
  assert.equal(
    mockState.taskRunCreations.length,
    2,
    "Should create 2 TaskRuns (2 attempts)"
  );
  assert.equal(
    mockState.taskRunCompletions.length,
    1,
    "completeTaskRun should be called once (on success)"
  );
  assert.equal(
    mockState.taskRunFailures.length,
    0,
    "No permanent failures (retry succeeded)"
  );

  // Verify exponential backoff: first retry waits ~1s (2^0 * 1000)
  assert(
    elapsed >= 900,
    `Expected elapsed time >= 900ms for 1s backoff, got ${elapsed}ms`
  );

  // Verify attempt details
  const attempt2 = mockState.taskRunCreations[1];
  assert.equal(attempt2.attemptNumber, 2, "Second attempt number should be 2");
  assert.equal(attempt2.retryCount, 1, "Second attempt retry count should be 1");
  assert(
    attempt2.retryReason && attempt2.retryReason.includes("First attempt failed"),
    `Retry reason should contain 'First attempt failed', got: ${attempt2.retryReason}`
  );
});

test("handleTaskWithRetry - multiple failures then success", async () => {
  resetMocks();

  const mockDb = {} as unknown;
  const mockTask = createMockTask({ max_retries: 3 });

  let attempts = 0;
  const runAgentMock = async () => {
    attempts++;
    if (attempts <= 2) {
      throw new Error(`Failure at attempt ${attempts}`);
    }
    return { response: "Success on third attempt" };
  };

  const startTime = Date.now();
  await handleTaskWithRetry(mockDb, mockTask, runAgentMock);
  const elapsed = Date.now() - startTime;

  assert.equal(attempts, 3, "runAgent should be called 3 times");
  assert.equal(
    mockState.taskRunCreations.length,
    3,
    "Should create 3 TaskRuns (3 attempts)"
  );
  assert.equal(
    mockState.taskRunCompletions.length,
    1,
    "completeTaskRun called once (on final success)"
  );
  assert.equal(mockState.taskRunFailures.length, 0, "No permanent failures");

  // Verify exponential backoff delays: 1s + 2s = 3000ms
  // With some tolerance for execution time, should be > 2800ms
  assert(
    elapsed >= 2800,
    `Expected elapsed time >= 2800ms for 1s+2s backoff, got ${elapsed}ms`
  );

  // Verify all task runs created with proper sequence
  for (let i = 0; i < 3; i++) {
    const creation = mockState.taskRunCreations[i];
    assert.equal(
      creation.attemptNumber,
      i + 1,
      `TaskRun ${i + 1} attempt number should be ${i + 1}`
    );
    assert.equal(
      creation.retryCount,
      i,
      `TaskRun ${i + 1} retry count should be ${i}`
    );
  }
});

test("handleTaskWithRetry - all attempts exhausted (permanent failure)", async () => {
  resetMocks();

  const mockDb = {} as unknown;
  const mockTask = createMockTask({ max_retries: 1 });

  const runAgentMock = async () => {
    throw new Error("Persistent failure");
  };

  await handleTaskWithRetry(mockDb, mockTask, runAgentMock);

  assert.equal(
    mockState.taskRunCreations.length,
    2,
    "Should create 2 TaskRuns (2 attempts total: 1 + max_retries)"
  );
  assert.equal(
    mockState.taskRunCompletions.length,
    0,
    "completeTaskRun should not be called"
  );
  assert.equal(
    mockState.taskRunFailures.length,
    1,
    "failTaskRun should be called once"
  );

  const failure = mockState.taskRunFailures[0];
  assert(
    failure.errorMessage.includes("Persistent failure"),
    `Error message should contain 'Persistent failure', got: ${failure.errorMessage}`
  );

  // Verify failure notification was sent
  assert.equal(
    mockState.telegramNotifications.length,
    1,
    "Failure notification should be sent"
  );
  const notification = mockState.telegramNotifications[0];
  assert(
    notification.message.includes("falló después de 2 intentos"),
    "Failure message should indicate 2 attempts"
  );
});

test("handleTaskWithRetry - max retries = 0 (no retries)", async () => {
  resetMocks();

  const mockDb = {} as unknown;
  const mockTask = createMockTask({ max_retries: 0 });

  const runAgentMock = async () => {
    throw new Error("Immediate failure");
  };

  const startTime = Date.now();
  await handleTaskWithRetry(mockDb, mockTask, runAgentMock);
  const elapsed = Date.now() - startTime;

  assert.equal(
    mockState.taskRunCreations.length,
    1,
    "Should create 1 TaskRun (1 attempt only)"
  );
  assert.equal(
    mockState.taskRunCompletions.length,
    0,
    "completeTaskRun should not be called"
  );
  assert.equal(
    mockState.taskRunFailures.length,
    1,
    "failTaskRun should be called immediately"
  );

  // Should fail immediately without waiting
  assert(
    elapsed < 500,
    `Expected immediate failure (<500ms), got ${elapsed}ms`
  );
});

test("handleTaskWithRetry - exponential backoff timing", async () => {
  resetMocks();

  const mockDb = {} as unknown;
  const mockTask = createMockTask({ max_retries: 3 });

  let attempts = 0;
  const runAgentMock = async () => {
    attempts++;
    if (attempts <= 3) {
      throw new Error(`Attempt ${attempts} failed`);
    }
    return { response: "Success" };
  };

  const startTime = Date.now();
  await handleTaskWithRetry(mockDb, mockTask, runAgentMock);
  const totalElapsed = Date.now() - startTime;

  // Expected delays: 2^0 * 1000 = 1000ms, then 2^1 * 1000 = 2000ms, then 2^2 * 1000 = 4000ms
  // Total: 7000ms, but allow ±200ms tolerance per delay for timing variance
  // Conservative check: total should be >= 6600ms (7000 - 400ms tolerance)
  assert(
    totalElapsed >= 6600,
    `Expected total elapsed >= 6600ms for exponential backoff (1s+2s+4s), got ${totalElapsed}ms`
  );

  assert.equal(
    mockState.taskRunCreations.length,
    4,
    "Should create 4 TaskRuns (4 attempts: 3 failures + 1 success)"
  );
  assert.equal(
    mockState.taskRunCompletions.length,
    1,
    "completeTaskRun called once on final success"
  );
});

test("handleTaskWithRetry - notification sent on success", async () => {
  resetMocks();

  const mockDb = {} as unknown;
  const mockTask = createMockTask({ max_retries: 1 });

  const runAgentMock = async () => {
    return { response: "Agent completed the task successfully" };
  };

  await handleTaskWithRetry(mockDb, mockTask, runAgentMock);

  assert.equal(
    mockState.telegramNotifications.length,
    1,
    "Success notification should be sent"
  );

  const notification = mockState.telegramNotifications[0];
  assert.equal(
    notification.userId,
    "user-1",
    "Notification should be sent to correct user"
  );
  assert(
    notification.message.includes("Tarea recurrente"),
    "Notification should include schedule type"
  );
  assert(
    notification.message.includes("Agent completed the task successfully"),
    "Notification should include agent response"
  );
});

test("handleTaskWithRetry - one-time task marked as completed", async () => {
  resetMocks();

  const mockDb = {} as unknown;
  const mockTask = createMockTask({
    max_retries: 1,
    schedule_type: "one_time",
  });

  const runAgentMock = async () => {
    return { response: "One-time task done" };
  };

  await handleTaskWithRetry(mockDb, mockTask, runAgentMock);

  assert.equal(
    mockState.taskRunCompletions.length,
    1,
    "completeTaskRun should be called"
  );

  const completion = mockState.taskRunCompletions[0];
  assert.equal(
    completion.newStatus,
    "completed",
    "One-time task should have status 'completed'"
  );
  assert.strictEqual(
    completion.nextRunAt,
    null,
    "One-time task should have null nextRunAt"
  );
});

test("handleTaskWithRetry - recurring task marked as active with next run time", async () => {
  resetMocks();

  const mockDb = {} as unknown;
  const mockTask = createMockTask({
    max_retries: 1,
    schedule_type: "recurring",
    cron_expr: "0 9 * * *",
  });

  const runAgentMock = async () => {
    return { response: "Recurring task done" };
  };

  await handleTaskWithRetry(mockDb, mockTask, runAgentMock);

  assert.equal(
    mockState.taskRunCompletions.length,
    1,
    "completeTaskRun should be called"
  );

  const completion = mockState.taskRunCompletions[0];
  assert.equal(
    completion.newStatus,
    "active",
    "Recurring task should remain 'active'"
  );
  assert(
    completion.nextRunAt !== null,
    "Recurring task should have a calculated nextRunAt"
  );
});
