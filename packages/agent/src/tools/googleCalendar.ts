import type { DbClient } from "@agents/db";
import {
  decrypt,
  encrypt,
  getActiveIntegrationCredentials,
  updateIntegrationTokens,
  markIntegrationExpired,
} from "@agents/db";

const GCAL_API = "https://www.googleapis.com/calendar/v3";

export interface GoogleTokenBundle {
  access_token: string;
  refresh_token?: string;
}

async function refreshGoogleAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  refresh_token?: string;
}> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth not configured");
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = (await res.json()) as Record<string, unknown>;
  if (!res.ok || data.error) {
    const err = String(data.error ?? "refresh_failed");
    const e = new Error(err);
    (e as Error & { oauthError?: string }).oauthError = err;
    throw e;
  }

  return {
    access_token: String(data.access_token),
    expires_in:
      typeof data.expires_in === "number"
        ? data.expires_in
        : Number(data.expires_in) || 3600,
    refresh_token:
      typeof data.refresh_token === "string"
        ? data.refresh_token
        : undefined,
  };
}

/**
 * Returns a valid Google access token, refreshing and persisting when near expiry.
 */
export async function resolveGoogleToken(
  db: DbClient,
  userId: string
): Promise<string | null> {
  const row = await getActiveIntegrationCredentials(db, userId, "google");
  if (!row?.encrypted_tokens) return null;

  let bundle: GoogleTokenBundle;
  try {
    bundle = JSON.parse(decrypt(row.encrypted_tokens)) as GoogleTokenBundle;
  } catch {
    return null;
  }
  if (!bundle.access_token?.trim()) return null;

  const expiresAtMs = row.expires_at
    ? new Date(row.expires_at).getTime()
    : 0;
  const skewMs = 60_000;
  const now = Date.now();

  if (expiresAtMs && now < expiresAtMs - skewMs) {
    return bundle.access_token;
  }

  if (!bundle.refresh_token?.trim()) {
    await markIntegrationExpired(db, userId, "google");
    return null;
  }

  try {
    const refreshed = await refreshGoogleAccessToken(bundle.refresh_token);
    const newAccess = refreshed.access_token;
    const newRefresh = refreshed.refresh_token ?? bundle.refresh_token;
    const newExpiresAt = new Date(
      Date.now() + refreshed.expires_in * 1000
    ).toISOString();
    const encrypted = encrypt(
      JSON.stringify({
        access_token: newAccess,
        refresh_token: newRefresh,
      })
    );
    await updateIntegrationTokens(db, userId, "google", encrypted, newExpiresAt);
    return newAccess;
  } catch (err) {
    const oauthError = (err as { oauthError?: string })?.oauthError;
    const msg = String(err).toLowerCase();
    if (
      oauthError === "invalid_grant" ||
      msg.includes("invalid_grant") ||
      oauthError === "refresh_failed"
    ) {
      await markIntegrationExpired(db, userId, "google");
    }
    return null;
  }
}

export async function gcalFetch(
  token: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const url = path.startsWith("http") ? path : `${GCAL_API}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...init?.headers,
    },
  });
}

function encodeCalId(calendarId: string | undefined): string {
  const id = calendarId?.trim() || "primary";
  return encodeURIComponent(id);
}

function encodeEventId(eventId: string): string {
  return encodeURIComponent(eventId);
}

function buildCreateEventBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {
    summary: args.summary,
    start: args.start,
    end: args.end,
  };
  if (args.description !== undefined && args.description !== "") {
    body.description = args.description;
  }
  if (args.location !== undefined && args.location !== "") {
    body.location = args.location;
  }
  if (Array.isArray(args.attendees) && (args.attendees as string[]).length > 0) {
    body.attendees = (args.attendees as string[]).map((email) => ({ email }));
  }
  return body;
}

function buildPatchEventBody(args: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const key of ["summary", "description", "location", "start", "end"] as const) {
    if (args[key] !== undefined) body[key] = args[key];
  }
  if (args.attendees !== undefined && Array.isArray(args.attendees)) {
    body.attendees = (args.attendees as string[]).map((email) => ({ email }));
  }
  return body;
}

export async function executeGoogleCalendarTool(
  toolName: string,
  args: Record<string, unknown>,
  token: string
): Promise<Record<string, unknown>> {
  switch (toolName) {
    case "google_calendar_list_calendars": {
      const res = await gcalFetch(token, "/users/me/calendarList", {
        method: "GET",
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Google Calendar API ${res.status}: ${body}`);
      }
      const data = (await res.json()) as {
        items?: Array<Record<string, unknown>>;
      };
      return {
        calendars: (data.items ?? []).map((c) => ({
          id: c.id,
          summary: c.summary,
          primary: c.primary,
          timeZone: c.timeZone,
        })),
      };
    }

    case "google_calendar_list_events": {
      const cal = encodeCalId(args.calendarId as string | undefined);
      const params = new URLSearchParams();
      if (args.timeMin) params.set("timeMin", String(args.timeMin));
      if (args.timeMax) params.set("timeMax", String(args.timeMax));
      if (args.q) params.set("q", String(args.q));
      const max = args.maxResults;
      if (typeof max === "number" && max > 0) {
        params.set("maxResults", String(Math.min(2500, Math.floor(max))));
      } else {
        params.set("maxResults", "50");
      }
      params.set("singleEvents", "true");
      const q = params.toString();
      const res = await gcalFetch(
        token,
        `/calendars/${cal}/events${q ? `?${q}` : ""}`,
        { method: "GET" }
      );
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Google Calendar API ${res.status}: ${body}`);
      }
      const data = (await res.json()) as {
        items?: Array<Record<string, unknown>>;
      };
      return {
        events: (data.items ?? []).map((e) => ({
          id: e.id,
          summary: e.summary,
          start: e.start,
          end: e.end,
          htmlLink: e.htmlLink,
          status: e.status,
        })),
      };
    }

    case "google_calendar_create_event": {
      const cal = encodeCalId(args.calendarId as string | undefined);
      const body = buildCreateEventBody(args);
      const res = await gcalFetch(token, `/calendars/${cal}/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Google Calendar API ${res.status}: ${text}`);
      }
      const event = (await res.json()) as Record<string, unknown>;
      return {
        message: "Event created",
        id: event.id,
        htmlLink: event.htmlLink,
        summary: event.summary,
      };
    }

    case "google_calendar_update_event": {
      const cal = encodeCalId(args.calendarId as string | undefined);
      const eid = encodeEventId(String(args.eventId));
      const body = buildPatchEventBody(args);
      const res = await gcalFetch(
        token,
        `/calendars/${cal}/events/${eid}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Google Calendar API ${res.status}: ${text}`);
      }
      const event = (await res.json()) as Record<string, unknown>;
      return {
        message: "Event updated",
        id: event.id,
        htmlLink: event.htmlLink,
        summary: event.summary,
      };
    }

    case "google_calendar_delete_event": {
      const cal = encodeCalId(args.calendarId as string | undefined);
      const eid = encodeEventId(String(args.eventId));
      const res = await gcalFetch(
        token,
        `/calendars/${cal}/events/${eid}`,
        { method: "DELETE" }
      );
      if (!res.ok && res.status !== 204) {
        const text = await res.text().catch(() => "");
        throw new Error(`Google Calendar API ${res.status}: ${text}`);
      }
      return { ok: true, message: "Event deleted" };
    }

    default:
      throw new Error(`Unknown Google Calendar tool: ${toolName}`);
  }
}
