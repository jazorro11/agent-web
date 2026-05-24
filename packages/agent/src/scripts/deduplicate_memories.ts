/**
 * One-shot deduplication script for existing memories.
 *
 * Run with:
 *   npx tsx packages/agent/src/scripts/deduplicate_memories.ts
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in apps/web/.env.local
 * (or as environment variables). Uses service_role to bypass RLS.
 */

import { createClient } from "@supabase/supabase-js";
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env.local without dotenv — try worktree location and repo root location
function loadEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && !(key in process.env)) process.env[key] = val;
  }
}

// Try worktree-local .env.local first, then walk up to the actual repo root
// (worktrees live at <repo>/.claude/worktrees/<name>/, so repo root is 3 levels up from worktree root)
const worktreeRoot = path.resolve(__dirname, "../../../..");
const repoRoot = path.resolve(worktreeRoot, "../../..");
loadEnvFile(path.join(worktreeRoot, "apps/web/.env.local"));
loadEnvFile(path.join(repoRoot, "apps/web/.env.local"));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !OPENROUTER_API_KEY) {
  console.error("Missing env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENROUTER_API_KEY");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const model = new ChatOpenAI({
  modelName: "anthropic/claude-haiku-4-5",
  temperature: 0,
  configuration: {
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: { "HTTP-Referer": "https://agents.local" },
  },
  apiKey: OPENROUTER_API_KEY,
});

const DEDUP_THRESHOLD = 0.92;
const MEMORY_TYPES = ["episodic", "semantic", "procedural"] as const;

const MERGE_SYSTEM_PROMPT = `Combina dos memorias que expresan información similar en una sola memoria más completa y concisa.
No pierdas información específica (fechas, nombres, datos concretos).
Responde ÚNICAMENTE con el texto de la memoria combinada, sin explicaciones ni formato.`;

async function mergeContents(existing: string, incoming: string): Promise<string> {
  const response = await model.invoke([
    new SystemMessage(MERGE_SYSTEM_PROMPT),
    new HumanMessage(`Memoria existente:\n${existing}\n\nNueva memoria:\n${incoming}\n\nCombina estas dos:`),
  ]);
  const result = typeof response.content === "string" ? response.content.trim() : "";
  return result || existing;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot   += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function getAllMemoriesByType(userId: string, type: string) {
  const { data, error } = await db
    .from("memories")
    .select("id, content, embedding, retrieval_count, created_at")
    .eq("user_id", userId)
    .eq("type", type)
    .not("embedding", "is", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function getAllUsers(): Promise<string[]> {
  const { data, error } = await db
    .from("memories")
    .select("user_id")
    .not("user_id", "is", null);
  if (error) throw error;
  const ids = new Set((data ?? []).map((r: { user_id: string }) => r.user_id));
  return [...ids];
}

function parseEmbedding(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === "string") return JSON.parse(raw) as number[];
  return [];
}

async function deduplicateForUser(userId: string): Promise<{ merged: number; deleted: number }> {
  let merged = 0;
  let deleted = 0;

  for (const type of MEMORY_TYPES) {
    const memories = await getAllMemoriesByType(userId, type);
    const eliminated = new Set<string>();

    for (let i = 0; i < memories.length; i++) {
      if (eliminated.has(memories[i].id)) continue;

      const embA = parseEmbedding(memories[i].embedding);
      if (embA.length === 0) continue;

      for (let j = i + 1; j < memories.length; j++) {
        if (eliminated.has(memories[j].id)) continue;

        const embB = parseEmbedding(memories[j].embedding);
        if (embB.length === 0) continue;
        const sim = cosineSimilarity(embA, embB);

        if (sim >= DEDUP_THRESHOLD) {
          console.log(`  [${type}] Merging (sim=${sim.toFixed(3)}):`);
          console.log(`    A: ${memories[i].content.slice(0, 80)}...`);
          console.log(`    B: ${memories[j].content.slice(0, 80)}...`);

          const mergedContent = await mergeContents(memories[i].content, memories[j].content);

          // Average embedding as approximation; close enough for dedup purposes
          const mergedEmb = embA.map((v, k) => (v + embB[k]) / 2);

          await db.from("memories").update({
            content:   mergedContent,
            embedding: JSON.stringify(mergedEmb),
          }).eq("id", memories[i].id);

          await db.from("memories").delete().eq("id", memories[j].id);

          // Update in-memory record so further comparisons use merged embedding
          memories[i] = { ...memories[i], content: mergedContent, embedding: mergedEmb as unknown as string };

          eliminated.add(memories[j].id);
          merged++;
          deleted++;
        }
      }
    }
  }

  return { merged, deleted };
}

async function main() {
  console.log("Starting memory deduplication...\n");

  const users = await getAllUsers();
  console.log(`Found ${users.length} user(s) with memories.\n`);

  let totalMerged = 0;
  let totalDeleted = 0;

  for (const userId of users) {
    console.log(`Processing user: ${userId}`);
    const { merged, deleted } = await deduplicateForUser(userId);
    totalMerged  += merged;
    totalDeleted += deleted;
    console.log(`  → ${merged} merged, ${deleted} deleted\n`);
  }

  console.log(`Done. Total merged: ${totalMerged}, total deleted: ${totalDeleted}`);
}

main().catch((err) => {
  console.error("Deduplication failed:", err);
  process.exit(1);
});
