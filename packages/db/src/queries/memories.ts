import type { DbClient } from "../client";

export type MemoryType = "episodic" | "semantic" | "procedural";

export interface Memory {
  id: string;
  user_id: string;
  type: MemoryType;
  content: string;
  embedding: number[] | null;
  retrieval_count: number;
  created_at: string;
  last_retrieved_at: string | null;
}

export interface MemorySearchResult {
  id: string;
  type: MemoryType;
  content: string;
  retrieval_count: number;
  similarity: number;
}

export async function saveMemory(
  db: DbClient,
  params: {
    userId: string;
    type: MemoryType;
    content: string;
    embedding: number[];
  }
): Promise<Memory> {
  const { data, error } = await db
    .from("memories")
    .insert({
      user_id: params.userId,
      type: params.type,
      content: params.content,
      embedding: JSON.stringify(params.embedding),
    })
    .select()
    .single();
  if (error) throw error;
  return data as Memory;
}

export async function searchMemories(
  db: DbClient,
  params: {
    userId: string;
    embedding: number[];
    limit?: number;
  }
): Promise<MemorySearchResult[]> {
  const { data, error } = await db.rpc("match_memories", {
    query_embedding: JSON.stringify(params.embedding),
    match_user_id: params.userId,
    match_count: params.limit ?? 8,
  });
  if (error) throw error;
  return (data ?? []) as MemorySearchResult[];
}

export async function incrementRetrievalCount(
  db: DbClient,
  ids: string[]
): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await db.rpc("increment_memory_retrieval_count", {
    memory_ids: ids,
  });
  if (error) throw error;
}

export async function findSimilarMemory(
  db: DbClient,
  params: {
    userId: string;
    type: MemoryType;
    embedding: number[];
    threshold?: number;
  }
): Promise<MemorySearchResult | null> {
  const { data, error } = await db.rpc("match_memories_by_type", {
    query_embedding:      JSON.stringify(params.embedding),
    match_user_id:        params.userId,
    match_type:           params.type,
    match_count:          1,
    similarity_threshold: params.threshold ?? 0.92,
  });
  if (error) throw error;
  return ((data ?? []) as MemorySearchResult[])[0] ?? null;
}

export async function updateMemory(
  db: DbClient,
  params: { id: string; content: string; embedding: number[] }
): Promise<void> {
  const { error } = await db
    .from("memories")
    .update({
      content:   params.content,
      embedding: JSON.stringify(params.embedding),
    })
    .eq("id", params.id);
  if (error) throw error;
}

export async function deleteMemory(db: DbClient, id: string): Promise<void> {
  const { error } = await db.from("memories").delete().eq("id", id);
  if (error) throw error;
}
