import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { DbClient } from "@agents/db";
import { getSessionMessages, saveMemory, findSimilarMemory, updateMemory } from "@agents/db";
import type { MemoryType } from "@agents/db";
import { generateEmbedding } from "./embeddings";

const DEDUP_THRESHOLD = 0.92;

const EXTRACTION_SYSTEM_PROMPT = `Eres un extractor de memoria a largo plazo para un agente de IA.

Tu tarea es analizar la transcripción de una sesión de conversación e identificar únicamente hechos que:
1. Seguirán siendo verdad en la próxima sesión del mismo usuario
2. Son útiles para que el agente personalice futuras interacciones
3. No son triviales ni relleno conversacional

Clasifica cada recuerdo en una de estas categorías:
- episodic: eventos específicos que ocurrieron (qué hizo el usuario y cuándo)
- semantic: preferencias, conocimiento durable, datos del usuario (nombre, empresa, tecnologías que usa, etc.)
- procedural: cómo opera el usuario, sus flujos de trabajo, sus rutinas con el agente

Reglas estrictas:
- Solo extrae lo que definitivamente recordarías si fueras un asistente humano inteligente
- No extraigas saludos, preguntas genéricas ni conversación de relleno
- No extraigas información efímera (el precio de algo hoy, una fecha pasada sin relevancia)
- Si no hay nada valioso que recordar, devuelve un array vacío
- Sé conciso: cada recuerdo debe ser una oración clara y autónoma

Responde ÚNICAMENTE con un JSON array válido, sin explicaciones ni markdown:
[
  { "type": "episodic|semantic|procedural", "content": "El recuerdo en texto" }
]`;

interface ExtractedMemory {
  type: MemoryType;
  content: string;
}

function createExtractionModel() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("Missing OPENROUTER_API_KEY");

  return new ChatOpenAI({
    modelName: "anthropic/claude-haiku-4-5",
    temperature: 0,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
      defaultHeaders: {
        "HTTP-Referer": "https://agents.local",
      },
    },
    apiKey,
  });
}

function formatTranscript(
  messages: Awaited<ReturnType<typeof getSessionMessages>>
): string {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => {
      const role = m.role === "user" ? "Usuario" : "Asistente";
      return `[${role}]: ${m.content}`;
    })
    .join("\n\n");
}

const MERGE_SYSTEM_PROMPT = `Combina dos memorias que expresan información similar en una sola memoria más completa y concisa.
No pierdas información específica (fechas, nombres, datos concretos).
Responde ÚNICAMENTE con el texto de la memoria combinada, sin explicaciones ni formato.`;

async function mergeMemoryContent(
  model: ChatOpenAI,
  existing: string,
  incoming: string
): Promise<string> {
  const response = await model.invoke([
    new SystemMessage(MERGE_SYSTEM_PROMPT),
    new HumanMessage(
      `Memoria existente:\n${existing}\n\nNueva memoria:\n${incoming}\n\nCombina estas dos:`
    ),
  ]);
  const result = typeof response.content === "string" ? response.content.trim() : "";
  return result || existing;
}

function parseExtractedMemories(raw: string): ExtractedMemory[] {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "")
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const valid: ExtractedMemory[] = [];
  for (const item of parsed) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).content === "string" &&
      ["episodic", "semantic", "procedural"].includes(
        (item as Record<string, unknown>).type as string
      )
    ) {
      valid.push({
        type: (item as Record<string, unknown>).type as MemoryType,
        content: ((item as Record<string, unknown>).content as string).trim(),
      });
    }
  }
  return valid;
}

/**
 * Extract and persist long-term memories from a completed session.
 *
 * Called fire-and-forget from the chat route after a normal (non-interrupted)
 * response — never blocks the HTTP response.
 *
 * Process:
 *  1. Load all messages for the session
 *  2. Ask Haiku to extract durable facts as JSON
 *  3. Generate an embedding for each extracted memory
 *  4. Insert into the `memories` Supabase table
 */
export async function flushSessionMemory(params: {
  db: DbClient;
  userId: string;
  sessionId: string;
}): Promise<void> {
  const { db, userId, sessionId } = params;

  const messages = await getSessionMessages(db, sessionId, 200);
  if (messages.length < 2) return; // Nothing meaningful to extract

  const transcript = formatTranscript(messages);
  if (!transcript.trim()) return;

  const model = createExtractionModel();

  let rawResponse: string;
  try {
    const response = await model.invoke([
      new SystemMessage(EXTRACTION_SYSTEM_PROMPT),
      new HumanMessage(
        `Transcripción de la sesión:\n\n${transcript}\n\nExtrae los recuerdos importantes ahora.`
      ),
    ]);
    rawResponse =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);
  } catch (err) {
    console.error("[memory_flush] LLM extraction failed:", err);
    return;
  }

  const memories = parseExtractedMemories(rawResponse);
  if (memories.length === 0) return;

  // Generate embeddings and upsert concurrently (in pairs to avoid rate-limit bursts).
  // For each memory: if a semantically similar one (same type, cosine >= DEDUP_THRESHOLD)
  // already exists, merge both contents with the LLM and update the existing row.
  // Otherwise insert as new.
  for (let i = 0; i < memories.length; i += 2) {
    const batch = memories.slice(i, i + 2);
    await Promise.allSettled(
      batch.map(async (mem) => {
        try {
          const embedding = await generateEmbedding(mem.content);
          const similar = await findSimilarMemory(db, {
            userId,
            type: mem.type,
            embedding,
            threshold: DEDUP_THRESHOLD,
          });
          if (similar) {
            const merged = await mergeMemoryContent(model, similar.content, mem.content);
            const mergedEmbedding = await generateEmbedding(merged);
            await updateMemory(db, { id: similar.id, content: merged, embedding: mergedEmbedding });
          } else {
            await saveMemory(db, { userId, type: mem.type, content: mem.content, embedding });
          }
        } catch (err) {
          console.error("[memory_flush] failed to save memory:", mem.content, err);
        }
      })
    );
  }
}
