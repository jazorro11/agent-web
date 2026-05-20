import { test } from "node:test";
import assert from "node:assert";
import type { ScheduledTask } from "@agents/types";

/**
 * Sorting function that mimics the SQL ordering logic in claimDueTasks:
 * 1. ORDER BY priority DESC (high > medium > low)
 * 2. ORDER BY next_run_at ASC (earliest first)
 */
function sortTasksByPriorityAndTime(
  tasks: Partial<ScheduledTask>[]
): Partial<ScheduledTask>[] {
  const priorityOrder = { high: 3, medium: 2, low: 1 };

  return tasks.sort((a, b) => {
    // Priority DESC: high (3) > medium (2) > low (1)
    const aPriority = priorityOrder[(a.priority as string) || "medium"] || 0;
    const bPriority = priorityOrder[(b.priority as string) || "medium"] || 0;
    const priorityDiff = bPriority - aPriority;

    if (priorityDiff !== 0) return priorityDiff;

    // If priorities are equal, sort by next_run_at ASC (earliest first)
    const aTime = a.next_run_at ? new Date(a.next_run_at).getTime() : 0;
    const bTime = b.next_run_at ? new Date(b.next_run_at).getTime() : 0;
    return aTime - bTime;
  });
}

/**
 * Test case 1: Same due time, different priorities
 * All tasks are due at the same time but with different priorities.
 * Expected order: HIGH, MEDIUM, LOW
 */
test("Test 1: Same due time, different priorities", (t) => {
  const mockTasks: Partial<ScheduledTask>[] = [
    {
      id: "task1",
      priority: "medium",
      next_run_at: "2026-05-19T14:00:00Z",
    },
    {
      id: "task2",
      priority: "high",
      next_run_at: "2026-05-19T14:00:00Z",
    },
    {
      id: "task3",
      priority: "low",
      next_run_at: "2026-05-19T14:00:00Z",
    },
  ];

  const sorted = sortTasksByPriorityAndTime(mockTasks);

  const expectedOrder = ["high", "medium", "low"];
  const actualOrder = sorted.map((t) => t.priority);

  assert.deepEqual(
    actualOrder,
    expectedOrder,
    `Expected priority order [${expectedOrder.join(", ")}], got [${actualOrder.join(", ")}]`
  );

  // Verify IDs match expected order
  assert.deepEqual(
    sorted.map((t) => t.id),
    ["task2", "task1", "task3"],
    "Task IDs should be in order: task2 (high), task1 (medium), task3 (low)"
  );
});

/**
 * Test case 2: Different due times, same priority
 * All tasks have the same priority but different due times.
 * Expected order: 1pm, 2pm, 3pm (FIFO - earliest first)
 */
test("Test 2: Different due times, same priority", (t) => {
  const mockTasks: Partial<ScheduledTask>[] = [
    {
      id: "task1",
      priority: "high",
      next_run_at: "2026-05-19T14:00:00Z", // 2pm
    },
    {
      id: "task2",
      priority: "high",
      next_run_at: "2026-05-19T13:00:00Z", // 1pm
    },
    {
      id: "task3",
      priority: "high",
      next_run_at: "2026-05-19T15:00:00Z", // 3pm
    },
  ];

  const sorted = sortTasksByPriorityAndTime(mockTasks);

  const expectedOrder = ["task2", "task1", "task3"]; // 1pm, 2pm, 3pm
  const actualOrder = sorted.map((t) => t.id);

  assert.deepEqual(
    actualOrder,
    expectedOrder,
    `Expected time order [${expectedOrder.join(", ")}], got [${actualOrder.join(", ")}]`
  );

  // Verify times are in ascending order
  const times = sorted.map((t) =>
    t.next_run_at ? new Date(t.next_run_at).getTime() : 0
  );
  for (let i = 1; i < times.length; i++) {
    assert.ok(
      times[i] >= times[i - 1],
      `Times should be in ascending order: ${times.join(" <= ")}`
    );
  }
});

/**
 * Test case 3: Different due times AND different priorities
 * Complex mix of priorities and due times.
 * Tasks: 3pm(LOW), 1pm(HIGH), 2pm(MEDIUM), 1pm(MEDIUM), 2pm(HIGH)
 * Expected order: 1pm(HIGH), 1pm(MEDIUM), 2pm(HIGH), 2pm(MEDIUM), 3pm(LOW)
 */
test("Test 3: Different due times and different priorities", (t) => {
  const mockTasks: Partial<ScheduledTask>[] = [
    {
      id: "task1",
      priority: "low",
      next_run_at: "2026-05-19T15:00:00Z", // 3pm
    },
    {
      id: "task2",
      priority: "high",
      next_run_at: "2026-05-19T13:00:00Z", // 1pm
    },
    {
      id: "task3",
      priority: "medium",
      next_run_at: "2026-05-19T14:00:00Z", // 2pm
    },
    {
      id: "task4",
      priority: "medium",
      next_run_at: "2026-05-19T13:00:00Z", // 1pm
    },
    {
      id: "task5",
      priority: "high",
      next_run_at: "2026-05-19T14:00:00Z", // 2pm
    },
  ];

  const sorted = sortTasksByPriorityAndTime(mockTasks);

  const expectedOrder = ["task2", "task5", "task4", "task3", "task1"];
  // Breakdown (sorted by priority DESC, then by time ASC):
  // task2: 1pm, HIGH
  // task5: 2pm, HIGH (same priority, later time)
  // task4: 1pm, MEDIUM (lower priority than HIGH)
  // task3: 2pm, MEDIUM (same priority as task4, later time)
  // task1: 3pm, LOW

  const actualOrder = sorted.map((t) => t.id);

  assert.deepEqual(
    actualOrder,
    expectedOrder,
    `Expected order [${expectedOrder.join(", ")}], got [${actualOrder.join(", ")}]`
  );

  // Verify the detailed breakdown
  const details = sorted.map((t) => ({
    id: t.id,
    priority: t.priority,
    time: t.next_run_at ? new Date(t.next_run_at).getUTCHours() : 0,
  }));

  assert.equal(
    details[0].priority,
    "high",
    "First task should be HIGH priority (task2: 1pm)"
  );
  assert.equal(
    details[0].time,
    13,
    "First task should be at 1pm (13:00)"
  );
  assert.equal(
    details[1].priority,
    "high",
    "Second task should be HIGH priority (task5: 2pm, same priority as first but later time)"
  );
  assert.equal(
    details[1].time,
    14,
    "Second task should be at 2pm (14:00)"
  );
  assert.equal(
    details[2].priority,
    "medium",
    "Third task should be MEDIUM priority (task4: 1pm, lower priority tier)"
  );
  assert.equal(
    details[2].time,
    13,
    "Third task should be at 1pm (13:00)"
  );
  assert.equal(
    details[4].priority,
    "low",
    "Last task should be LOW priority"
  );
  assert.equal(
    details[4].time,
    15,
    "Last task should be at 3pm (15:00)"
  );
});

/**
 * Test case 4: All high priority
 * All tasks have the same HIGH priority but different due times.
 * Expected order: 1pm, 2pm, 3pm (FIFO - earliest first)
 */
test("Test 4: All high priority", (t) => {
  const mockTasks: Partial<ScheduledTask>[] = [
    {
      id: "task1",
      priority: "high",
      next_run_at: "2026-05-19T14:00:00Z", // 2pm
    },
    {
      id: "task2",
      priority: "high",
      next_run_at: "2026-05-19T13:00:00Z", // 1pm
    },
    {
      id: "task3",
      priority: "high",
      next_run_at: "2026-05-19T15:00:00Z", // 3pm
    },
  ];

  const sorted = sortTasksByPriorityAndTime(mockTasks);

  const expectedOrder = ["task2", "task1", "task3"]; // 1pm, 2pm, 3pm
  const actualOrder = sorted.map((t) => t.id);

  assert.deepEqual(
    actualOrder,
    expectedOrder,
    `Expected time order [${expectedOrder.join(", ")}], got [${actualOrder.join(", ")}]`
  );

  // Verify all are HIGH priority
  const allHigh = sorted.every((t) => t.priority === "high");
  assert.ok(allHigh, "All tasks should have HIGH priority");
});

/**
 * Test case 5: Single task
 * A single task should be returned as-is.
 * Expected: the one task is returned
 */
test("Test 5: Single task", (t) => {
  const mockTasks: Partial<ScheduledTask>[] = [
    {
      id: "task1",
      priority: "medium",
      next_run_at: "2026-05-19T14:00:00Z",
    },
  ];

  const sorted = sortTasksByPriorityAndTime(mockTasks);

  assert.equal(
    sorted.length,
    1,
    "Should return exactly one task"
  );
  assert.equal(
    sorted[0].id,
    "task1",
    "Should return the single task with correct ID"
  );
  assert.equal(
    sorted[0].priority,
    "medium",
    "Task should maintain its priority"
  );
});

/**
 * Test case 6: Empty task list
 * An empty list should return an empty list.
 */
test("Test 6: Empty task list", (t) => {
  const mockTasks: Partial<ScheduledTask>[] = [];

  const sorted = sortTasksByPriorityAndTime(mockTasks);

  assert.equal(
    sorted.length,
    0,
    "Should return empty array for empty input"
  );
  assert.deepEqual(
    sorted,
    [],
    "Result should be an empty array"
  );
});

/**
 * Test case 7: Priority order verification
 * Explicitly verify that priority values are ordered correctly:
 * HIGH (3) > MEDIUM (2) > LOW (1)
 */
test("Test 7: Priority order verification", (t) => {
  const mockTasks: Partial<ScheduledTask>[] = [
    {
      id: "low1",
      priority: "low",
      next_run_at: "2026-05-19T10:00:00Z",
    },
    {
      id: "medium1",
      priority: "medium",
      next_run_at: "2026-05-19T10:00:00Z",
    },
    {
      id: "high1",
      priority: "high",
      next_run_at: "2026-05-19T10:00:00Z",
    },
    {
      id: "low2",
      priority: "low",
      next_run_at: "2026-05-19T10:00:00Z",
    },
  ];

  const sorted = sortTasksByPriorityAndTime(mockTasks);

  // All tasks due at same time, so order should be by priority only
  // HIGH first, then MEDIUM, then LOW
  const priorities = sorted.map((t) => t.priority);

  assert.deepEqual(
    priorities,
    ["high", "medium", "low", "low"],
    "Tasks with same due time should be ordered: HIGH, MEDIUM, LOW, LOW"
  );
});
