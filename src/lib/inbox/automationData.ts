import { DEFAULT_FOLLOW_UP_HOURS, leadSignal, replyWindowOpen, type LeadSignal } from "./leads";
import { isUuid } from "./format";
import { settingsFromRow, type InboxSettings } from "./settings";

// Read-only Phase 10 queries (inbox_settings, inbox_conversation_state and the Phase 4 tables), through the owner's own session and filtered on the
// owner's profile id exactly like data.ts. Failures degrade to "no extra information" (the inbox itself keeps working) and log a short code only.

type Client = { from(table: string): any };

export interface AutomationView {
  /** conversation id -> derived lead signal */
  signals: Record<string, LeadSignal>;
  /** conversation id -> a free-form reply is still possible */
  windowOpen: Record<string, boolean>;
  /** outbound message ids that were the automatic acknowledgement (so they are labelled as such) */
  automaticMessageIds: string[];
}

const fail = (code: unknown) => console.error(JSON.stringify({ scope: "inbox_automation_data", result: "query_failed", code: typeof code === "string" ? code.slice(0, 20) : "unknown" }));

/** The owner's settings. null = settings are not available (table missing or unreadable): the page then says so instead of showing defaults as if saved. */
export async function loadInboxSettings(client: Client, profileId: string): Promise<{ ok: true; settings: InboxSettings; saved: boolean } | { ok: false }> {
  try {
    const res = await client.from("inbox_settings").select("*").eq("profile_id", profileId).maybeSingle();
    if (res.error) return fail(res.error.code), { ok: false };
    return { ok: true, settings: settingsFromRow(res.data ?? null), saved: !!res.data };
  } catch {
    fail("exception");
    return { ok: false };
  }
}

/** Lead signals, reply-window state and the automatic-message labels for the given conversations. null when unavailable. */
export async function loadAutomationView(client: Client, profileId: string, conversationIds: string[], now: Date = new Date()): Promise<AutomationView | null> {
  const ids = Array.from(new Set(conversationIds.filter(isUuid))).slice(0, 100);
  if (ids.length === 0) return { signals: {}, windowOpen: {}, automaticMessageIds: [] };
  try {
    const [convs, outbound, state, settings] = await Promise.all([
      client.from("inbox_conversations").select("id, status, last_inbound_at, contact_id").eq("profile_id", profileId).in("id", ids),
      client.from("inbox_messages").select("conversation_id, id, created_at").eq("profile_id", profileId).eq("direction", "outbound").in("conversation_id", ids).order("created_at", { ascending: false }).limit(1000),
      client.from("inbox_conversation_state").select("conversation_id, auto_ack_message_ids").eq("profile_id", profileId).in("conversation_id", ids),
      client.from("inbox_settings").select("follow_up_after_hours").eq("profile_id", profileId).maybeSingle(),
    ]);
    for (const r of [convs, outbound, state]) if (r.error) return fail(r.error.code), null;
    // the settings row is optional (and the table may not exist yet): a failure here only means "use the default hours"
    const after = typeof settings.data?.follow_up_after_hours === "number" ? settings.data.follow_up_after_hours : DEFAULT_FOLLOW_UP_HOURS;

    const contactIds = Array.from(new Set((convs.data ?? []).map((c: any) => c.contact_id)));
    const contacts = contactIds.length > 0 ? await client.from("inbox_contacts").select("id, bk_customer_id").eq("profile_id", profileId).in("id", contactIds) : { data: [], error: null };
    if (contacts.error) return fail(contacts.error.code), null;
    const isCustomer = new Map<string, boolean>((contacts.data ?? []).map((c: any) => [c.id, !!c.bk_customer_id]));

    const automatic = new Set<string>();
    for (const s of state.data ?? []) for (const m of s.auto_ack_message_ids ?? []) automatic.add(m);
    const lastHuman = new Map<string, string>();
    for (const m of outbound.data ?? []) {
      if (automatic.has(m.id)) continue;
      const cur = lastHuman.get(m.conversation_id);
      if (!cur || Date.parse(m.created_at) > Date.parse(cur)) lastHuman.set(m.conversation_id, m.created_at);
    }

    const view: AutomationView = { signals: {}, windowOpen: {}, automaticMessageIds: [...automatic] };
    for (const c of convs.data ?? []) {
      view.signals[c.id] = leadSignal({ status: c.status === "closed" ? "closed" : "open", isCustomer: isCustomer.get(c.contact_id) === true, lastInboundAt: c.last_inbound_at ?? null, lastHumanOutboundAt: lastHuman.get(c.id) ?? null }, after, now);
      view.windowOpen[c.id] = replyWindowOpen(c.last_inbound_at ?? null, now);
    }
    return view;
  } catch {
    fail("exception");
    return null;
  }
}
