-- RPC for dedup-aware memory search: filters by type and enforces a similarity threshold
-- Used by memory_flush.ts before inserting a new memory to detect semantic duplicates
CREATE OR REPLACE FUNCTION match_memories_by_type(
  query_embedding      vector(1536),
  match_user_id        UUID,
  match_type           TEXT,
  match_count          INT   DEFAULT 1,
  similarity_threshold FLOAT DEFAULT 0.92
)
RETURNS TABLE (
  id              UUID,
  type            TEXT,
  content         TEXT,
  retrieval_count INT,
  similarity      FLOAT
)
LANGUAGE SQL STABLE
AS $$
  SELECT
    id,
    type,
    content,
    retrieval_count,
    1 - (embedding <=> query_embedding) AS similarity
  FROM memories
  WHERE user_id = match_user_id
    AND type    = match_type
    AND embedding IS NOT NULL
    AND 1 - (embedding <=> query_embedding) >= similarity_threshold
  ORDER BY embedding <=> query_embedding
  LIMIT match_count;
$$;
