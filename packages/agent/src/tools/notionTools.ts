import type { DbClient } from "@agents/db";
import { decrypt, getActiveIntegrationCredentials } from "@agents/db";

const NOTION_API = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

function notionHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json",
  };
}

async function notionFetch(
  token: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  return fetch(`${NOTION_API}${path}`, {
    ...init,
    headers: {
      ...notionHeaders(token),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
}

/** Extracts a UUID from a Notion page URL or returns the raw ID as-is. */
function extractPageId(idOrUrl: string): string {
  const cleaned = idOrUrl.trim();
  // UUID with dashes (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
  const uuidMatch = cleaned.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
  );
  if (uuidMatch) return uuidMatch[0];
  // 32 hex chars at end of URL (no dashes), before optional ? or #
  const hexMatch = cleaned.match(/([0-9a-f]{32})(?:[?#]|$)/i);
  if (hexMatch) return hexMatch[1];
  return cleaned;
}

function extractRichText(richText: Array<Record<string, unknown>>): string {
  return (richText ?? []).map((t) => (t.plain_text as string) ?? "").join("");
}

/** Finds the title property regardless of its key name in the page properties. */
function extractTitle(properties: Record<string, unknown>): string {
  for (const val of Object.values(properties)) {
    const p = val as Record<string, unknown>;
    if (p.type === "title") {
      return extractRichText(p.title as Array<Record<string, unknown>>);
    }
  }
  return "(sin título)";
}

/** Converts a single block to readable plain text with lightweight Markdown. */
function blockToText(block: Record<string, unknown>): string {
  const type = block.type as string;
  const inner = block[type] as Record<string, unknown> | undefined;
  if (!inner?.rich_text) return "";
  const text = extractRichText(inner.rich_text as Array<Record<string, unknown>>);
  if (!text) return "";
  if (type === "heading_1") return `# ${text}`;
  if (type === "heading_2") return `## ${text}`;
  if (type === "heading_3") return `### ${text}`;
  if (type === "bulleted_list_item") return `• ${text}`;
  if (type === "numbered_list_item") return `1. ${text}`;
  return text;
}

/**
 * Resolves the Notion access token for the given user.
 * Supports both OAuth format ({ access_token }) and legacy plain-text tokens.
 */
export async function resolveNotionToken(
  db: DbClient,
  userId: string
): Promise<string | null> {
  const row = await getActiveIntegrationCredentials(db, userId, "notion");
  if (!row?.encrypted_tokens) return null;
  try {
    const decrypted = decrypt(row.encrypted_tokens);
    try {
      const parsed = JSON.parse(decrypted) as { access_token?: string };
      return parsed.access_token ?? decrypted;
    } catch {
      return decrypted;
    }
  } catch {
    return null;
  }
}

export async function executeNotionSearch(
  query: string,
  filter: "page" | "database" | undefined,
  token: string
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { query, page_size: 10 };
  if (filter) body.filter = { value: filter, property: "object" };

  const res = await notionFetch(token, "/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Notion API ${res.status}: ${text}`);
  }
  const data = (await res.json()) as { results: Array<Record<string, unknown>> };
  return {
    results: (data.results ?? []).map((item) => ({
      id: item.id,
      type: item.object,
      title: extractTitle((item.properties as Record<string, unknown>) ?? {}),
      url: item.url,
      last_edited_time: item.last_edited_time,
    })),
  };
}

const MAX_BLOCKS = 500;

export async function executeNotionGetPage(
  pageIdOrUrl: string,
  token: string
): Promise<Record<string, unknown>> {
  const id = extractPageId(pageIdOrUrl);
  const pageRes = await notionFetch(token, `/pages/${id}`);
  if (!pageRes.ok) {
    const text = await pageRes.text().catch(() => "");
    throw new Error(`Notion API ${pageRes.status}: ${text}`);
  }
  const page = (await pageRes.json()) as Record<string, unknown>;
  const title = extractTitle((page.properties as Record<string, unknown>) ?? {});

  const allBlocks: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  let hasMore = true;
  let truncated = false;

  while (hasMore && allBlocks.length < MAX_BLOCKS) {
    const path = `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${cursor}` : ""}`;
    const res = await notionFetch(token, path);
    if (!res.ok) break;
    const data = (await res.json()) as {
      results: Array<Record<string, unknown>>;
      has_more: boolean;
      next_cursor: string | null;
    };
    allBlocks.push(...(data.results ?? []));
    hasMore = data.has_more;
    cursor = data.next_cursor ?? undefined;
  }

  if (hasMore) truncated = true;

  const content = allBlocks.map(blockToText).filter(Boolean).join("\n");

  return {
    id: page.id,
    title,
    url: page.url,
    last_edited_time: page.last_edited_time,
    content,
    ...(truncated ? { truncated: true, note: "Contenido parcial: la página excede 500 bloques." } : {}),
  };
}

/** Fetches the title property key from a Notion database schema (commonly "Name" or "Title"). */
async function getDatabaseTitleKey(databaseId: string, token: string): Promise<string> {
  const res = await notionFetch(token, `/databases/${databaseId}`);
  if (!res.ok) return "title";
  const db = (await res.json()) as Record<string, unknown>;
  const properties = db.properties as Record<string, Record<string, unknown>> | undefined;
  if (!properties) return "title";
  for (const [key, prop] of Object.entries(properties)) {
    if (prop.type === "title") return key;
  }
  return "title";
}

export async function executeNotionCreatePage(
  parentId: string,
  parentType: "page" | "database",
  title: string,
  content: string | undefined,
  token: string
): Promise<Record<string, unknown>> {
  const parent =
    parentType === "database"
      ? { database_id: parentId }
      : { page_id: parentId };

  const titleKey =
    parentType === "database"
      ? await getDatabaseTitleKey(parentId, token)
      : "title";

  const body: Record<string, unknown> = {
    parent,
    properties: {
      [titleKey]: { title: [{ type: "text", text: { content: title } }] },
    },
  };

  if (content) {
    body.children = [
      {
        object: "block",
        type: "paragraph",
        paragraph: {
          rich_text: [{ type: "text", text: { content } }],
        },
      },
    ];
  }

  const res = await notionFetch(token, "/pages", {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Notion API ${res.status}: ${text}`);
  }
  const page = (await res.json()) as Record<string, unknown>;
  return {
    ok: true,
    id: page.id,
    url: page.url,
    title,
    message: `Página "${title}" creada correctamente en Notion.`,
  };
}
