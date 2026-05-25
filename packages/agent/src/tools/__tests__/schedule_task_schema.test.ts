import { test } from "node:test";
import assert from "node:assert";
import { TOOL_SCHEMAS } from "../schemas";

const scheduleTaskSchema = TOOL_SCHEMAS.schedule_task;

test("schedule_task schema - valid all fields", async (t) => {
  const input = {
    prompt: "Generate daily report",
    scheduleType: "recurring",
    cronExpr: "0 9 * * *",
    timezone: "America/New_York",
    name: "Daily Report",
    description: "Generate daily summary",
    tags: ["reports", "daily"],
    priority: "high",
    maxRetries: 3,
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(
    result.success,
    `Expected valid, got: ${JSON.stringify(result.error)}`
  );
  assert.equal(result.data.name, "Daily Report");
  assert.equal(result.data.priority, "high");
  assert.equal(result.data.maxRetries, 3);
});

test("schedule_task schema - valid only required fields", async (t) => {
  const input = {
    prompt: "Quick Task",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: "Quick Task",
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(
    result.success,
    `Expected valid, got: ${JSON.stringify(result.error)}`
  );
  // Verify defaults are applied
  assert.equal(result.data.priority, "medium");
  assert.deepEqual(result.data.tags, []);
  assert.equal(result.data.maxRetries, 0);
});

test("schedule_task schema - valid empty description", async (t) => {
  const input = {
    prompt: "Task with empty desc",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: "Task",
    description: "",
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(
    result.success,
    `Expected valid, got: ${JSON.stringify(result.error)}`
  );
  assert.equal(result.data.description, "");
});

test("schedule_task schema - valid empty tags array", async (t) => {
  const input = {
    prompt: "Task with no tags",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: "Task",
    tags: [],
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(
    result.success,
    `Expected valid, got: ${JSON.stringify(result.error)}`
  );
  assert.deepEqual(result.data.tags, []);
});

test("schedule_task schema - invalid empty name", async (t) => {
  const input = {
    prompt: "Task",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: "",
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(!result.success, "Expected validation error for empty name");
});

test("schedule_task schema - invalid missing name", async (t) => {
  const input = {
    prompt: "Task",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(!result.success, "Expected validation error for missing name");
});

test("schedule_task schema - invalid priority value", async (t) => {
  const input = {
    prompt: "Task",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: "Task",
    priority: "urgent",
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(
    !result.success,
    "Expected validation error for invalid priority 'urgent'"
  );
});

test("schedule_task schema - invalid maxRetries below 0", async (t) => {
  const input = {
    prompt: "Task",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: "Task",
    maxRetries: -1,
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(!result.success, "Expected validation error for maxRetries < 0");
});

test("schedule_task schema - invalid maxRetries above 10", async (t) => {
  const input = {
    prompt: "Task",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: "Task",
    maxRetries: 11,
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(!result.success, "Expected validation error for maxRetries > 10");
});

test("schedule_task schema - valid maxRetries boundary 0", async (t) => {
  const input = {
    prompt: "Task",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: "Task",
    maxRetries: 0,
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(
    result.success,
    `Expected valid for maxRetries=0, got: ${JSON.stringify(result.error)}`
  );
  assert.equal(result.data.maxRetries, 0);
});

test("schedule_task schema - valid maxRetries boundary 10", async (t) => {
  const input = {
    prompt: "Task",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: "Task",
    maxRetries: 10,
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(
    result.success,
    `Expected valid for maxRetries=10, got: ${JSON.stringify(result.error)}`
  );
  assert.equal(result.data.maxRetries, 10);
});

test("schedule_task schema - valid name at max boundary (255 chars)", async (t) => {
  const longName = "a".repeat(255);
  const input = {
    prompt: "Task",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: longName,
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(
    result.success,
    `Expected valid for 255-char name, got: ${JSON.stringify(result.error)}`
  );
  assert.equal(result.data.name.length, 255);
});

test("schedule_task schema - invalid name exceeds 255 chars", async (t) => {
  const input = {
    prompt: "Task",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: "a".repeat(256),
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(!result.success, "Expected validation error for name > 255 characters");
});

test("schedule_task schema - valid tags with special characters", async (t) => {
  const input = {
    prompt: "Task",
    scheduleType: "one_time",
    runAt: "2025-12-25T10:00:00Z",
    name: "Task",
    tags: ["tag-with-dash", "tag_with_underscore", "tag.with.dots"],
  };
  const result = scheduleTaskSchema.safeParse(input);
  assert(
    result.success,
    `Expected valid for special char tags, got: ${JSON.stringify(result.error)}`
  );
  assert.deepEqual(result.data.tags, [
    "tag-with-dash",
    "tag_with_underscore",
    "tag.with.dots",
  ]);
});
