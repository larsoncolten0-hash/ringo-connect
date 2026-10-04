import { SAVED_REPLY_LIMIT, isUuid, messageDisplay, normalizeSearch, sortThread, type InboxStatusFilter, type MessageDisplay } from "./format";

// Read-only Inbox queries (Phase 4 tables: inbox_conversations, inbox_contacts, inbox_messages, inbox_message_media).
//
// Every function takes the request-scoped Supabase client (the signed-in user's own session, so the tables' owner-read RLS applies
// on top) AND the owner's profile id, which the CALLER derived on the server from the session (see access.ts). Each query also
// filters on that profile id explicitly, so isolation does not depend on RLS alone. Nothing here accepts an id from the browser
// except the conversation id, which is validated as a UUID and still only ever matches rows of the owner's profile.
// Failures return { ok: false } and log a short code only (never row data, which would include message text and phone numbers).

type Client = { from(table: string): any };

export interface ConversationItem {
  id: string;
  channel: string;
  status: "open" | "closed";
  unreadCount: number;
  lastMessageAt: string | null;
  contactName: string | null;
  preview: MessageDisplay | null;
  lastDirection: "inbound" | "outbound" | null;
}

export interface ThreadMessage {
  id: string;
  direction: "inbound" | "outbound";
  status: string;
  at: string;
  display: MessageDisplay;
  /** An outbound message still 'queued' long after it was created: Meta's answer never arrived. Shown as "not confirmed", never re-sent automatically. */
  unconfirmed: boolean;
}

export interface ThreadData {
  /** replyWindowOpen: the customer wrote within the last 24 hours, so a free-form reply is allowed (the database enforces it too). */
  conversation: { id: string; channel: string; status: "open" | "closed"; replyWindowOpen: boolean };
  contact: { name: string | null; waId: string };
  messages: ThreadMessage[];
  truncated: boolean;
}

export const LIST_LIMIT = 40;
const UNCONFIRMED_AFTER_MS = 2 * 60 * 1000;
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;
const isWindowOpen = (lastInbound: unknown) => typeof lastInbound === "string" && Date.now() - Date.parse(lastInbound) < REPLY_WINDOW_MS;
export const THREAD_LIMIT = 100;

function fail(code: unknown) {
  console.error(JSON.stringify({ scope: "inbox", result: "query_failed", code: typeof code === "string" ? code.slice(0, 20) : "unknown" }));
}

export interface ListOptions {
  /** Which conversations to list. Default "all" (the Phase 6 behaviour). */
  status?: InboxStatusFilter;
  /** What the person typed in the search box. Sanitised here; a term that is too short is ignored. */
  query?: string;
}
/** At most this many matching contacts (most recently active first) are searched per request. */
export const SEARCH_CONTACT_CAP = 100;

export async function loadConversationList(client: Client, profileId: string, limit = LIST_LIMIT, options: ListOptions = {}): Promise<{ ok: true; items: ConversationItem[]; truncated: boolean } | { ok: false }> {
  try {
    let q = client
      .from("inbox_conversations")
      .select("id, channel, status, unread_count, last_message_at, contact_id")
      .eq("profile_id", profileId);
    if (options.status === "open" || options.status === "closed") q = q.eq("status", options.status);

    // Search by customer name or number: first the matching CONTACTS of this profile, then their conversations. The term can only
    // be letters, digits, spaces, apostrophes and hyphens (see normalizeSearch), so it cannot change the shape of the filter.
    const term = normalizeSearch(options.query);
    let searchCapped = false;
    if (term) {
      const clauses = [`display_name.ilike.%${term.text}%`];
      if (term.digits) clauses.push(`external_id.ilike.%${term.digits}%`);
      // The matching contacts are taken MOST RECENTLY ACTIVE FIRST and capped (it bounds the size of the next query). One extra row is fetched
      // only to know whether the cap was hit, so a very broad search is reported as limited instead of silently missing recent matches.
      const found = await client.from("inbox_contacts").select("id").eq("profile_id", profileId).or(clauses.join(",")).order("last_seen_at", { ascending: false }).order("id", { ascending: false }).limit(SEARCH_CONTACT_CAP + 1);
      if (found.error) return fail(found.error.code), { ok: false };
      const matched: string[] = (found.data ?? []).map((c: any) => c.id);
      searchCapped = matched.length > SEARCH_CONTACT_CAP;
      const ids = matched.slice(0, SEARCH_CONTACT_CAP);
      if (ids.length === 0) return { ok: true, items: [], truncated: false };
      q = q.in("contact_id", ids);
    }

    const convs = await q
      .order("last_message_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);
    if (convs.error) return fail(convs.error.code), { ok: false };
    const fetched: any[] = convs.data ?? [];
    // One extra row is fetched only to know whether the list is complete; it is never shown.
    const truncated = fetched.length > limit || searchCapped;
    const rows = fetched.slice(0, limit);
    if (rows.length === 0) return { ok: true, items: [], truncated: false };

    const contactIds = Array.from(new Set(rows.map((r) => r.contact_id)));
    const [contacts, ...latest] = await Promise.all([
      client.from("inbox_contacts").select("id, display_name").eq("profile_id", profileId).in("id", contactIds),
      // The latest message of each listed conversation: one tiny indexed query each (the page is capped at LIST_LIMIT conversations).
      ...rows.map((r) =>
        client
          .from("inbox_messages")
          .select("conversation_id, direction, type, body, received_at")
          .eq("profile_id", profileId)
          .eq("conversation_id", r.id)
          .order("received_at", { ascending: false })
          .limit(1),
      ),
    ]);
    if (contacts.error) return fail(contacts.error.code), { ok: false };
    if (latest.some((l: any) => l.error)) return fail(latest.find((l: any) => l.error).error.code), { ok: false };

    const names = new Map<string, string | null>((contacts.data ?? []).map((c: any) => [c.id, c.display_name ?? null]));
    const items: ConversationItem[] = rows.map((r, i) => {
      const m = latest[i].data?.[0] ?? null;
      return {
        id: r.id,
        channel: r.channel,
        status: r.status === "closed" ? "closed" : "open",
        unreadCount: typeof r.unread_count === "number" ? r.unread_count : 0,
        lastMessageAt: r.last_message_at ?? null,
        contactName: names.get(r.contact_id) ?? null,
        preview: m ? messageDisplay({ type: m.type, body: m.body }) : null,
        lastDirection: m ? (m.direction === "outbound" ? "outbound" : "inbound") : null,
      };
    });
    return { ok: true, items, truncated };
  } catch {
    fail("exception");
    return { ok: false };
  }
}

export async function loadThread(client: Client, profileId: string, conversationId: string, limit = THREAD_LIMIT): Promise<{ ok: true; thread: ThreadData } | { ok: false; reason: "not_found" | "error" }> {
  if (!isUuid(conversationId)) return { ok: false, reason: "not_found" };
  try {
    const conv = await client
      .from("inbox_conversations")
      .select("id, channel, status, contact_id, last_inbound_at")
      .eq("profile_id", profileId)
      .eq("id", conversationId)
      .maybeSingle();
    if (conv.error) return fail(conv.error.code), { ok: false, reason: "error" };
    if (!conv.data) return { ok: false, reason: "not_found" };

    const [contact, msgs] = await Promise.all([
      client.from("inbox_contacts").select("display_name, external_id").eq("profile_id", profileId).eq("id", conv.data.contact_id).maybeSingle(),
      client
        .from("inbox_messages")
        .select("id, direction, type, body, status, provider_timestamp, received_at")
        .eq("profile_id", profileId)
        .eq("conversation_id", conversationId)
        .order("received_at", { ascending: false })
        .limit(limit + 1),
    ]);
    if (contact.error) return fail(contact.error.code), { ok: false, reason: "error" };
    if (msgs.error) return fail(msgs.error.code), { ok: false, reason: "error" };

    const all: any[] = msgs.data ?? [];
    const truncated = all.length > limit;
    const rows = sortThread(all.slice(0, limit));

    const media = new Map<string, { kind: string; caption: string | null; filename: string | null; mimeType: string | null }>();
    const ids = rows.map((r) => r.id);
    if (ids.length > 0) {
      const md = await client.from("inbox_message_media").select("message_id, kind, caption, filename, mime_type").eq("profile_id", profileId).in("message_id", ids);
      if (md.error) return fail(md.error.code), { ok: false, reason: "error" };
      for (const m of md.data ?? []) media.set(m.message_id, { kind: m.kind, caption: m.caption ?? null, filename: m.filename ?? null, mimeType: m.mime_type ?? null });
    }

    return {
      ok: true,
      thread: {
        conversation: { id: conv.data.id, channel: conv.data.channel, status: conv.data.status === "closed" ? "closed" : "open", replyWindowOpen: isWindowOpen(conv.data.last_inbound_at) },
        contact: { name: contact.data?.display_name ?? null, waId: contact.data?.external_id ?? "" },
        messages: rows.map((r) => ({
          id: r.id,
          direction: r.direction === "outbound" ? "outbound" : "inbound",
          status: r.status,
          at: r.provider_timestamp || r.received_at,
          display: messageDisplay({ type: r.type, body: r.body }, media.get(r.id) ?? null),
          unconfirmed: r.direction === "outbound" && r.status === "queued" && Date.now() - Date.parse(r.provider_timestamp || r.received_at) > UNCONFIRMED_AFTER_MS,
        })),
        truncated,
      },
    };
  } catch {
    fail("exception");
    return { ok: false, reason: "error" };
  }
}

/** How many OPEN conversations have unread messages (for the "Open" tab). Counts only; reads no message and changes nothing. */
export async function countUnreadOpen(client: Client, profileId: string): Promise<number> {
  try {
    const res = await client.from("inbox_conversations").select("id", { count: "exact", head: true }).eq("profile_id", profileId).eq("status", "open").gt("unread_count", 0);
    if (res.error) return fail(res.error.code), 0;
    return typeof res.count === "number" ? res.count : 0;
  } catch {
    fail("exception");
    return 0;
  }
}

export interface SavedReply {
  id: string;
  title: string;
  body: string;
}

/** The owner's saved replies (read through her own session, RLS owner-read, and filtered on her profile id). */
export async function loadSavedReplies(client: Client, profileId: string): Promise<{ ok: true; items: SavedReply[] } | { ok: false }> {
  try {
    const res = await client.from("inbox_saved_replies").select("id, title, body").eq("profile_id", profileId).order("title", { ascending: true }).limit(SAVED_REPLY_LIMIT);
    if (res.error) return fail(res.error.code), { ok: false };
    return { ok: true, items: (res.data ?? []).map((r: any) => ({ id: r.id, title: r.title, body: r.body })) };
  } catch {
    fail("exception");
    return { ok: false };
  }
}
