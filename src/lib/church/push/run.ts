import { doualaDate } from "../content/publicWord";
import { TOPIC_OF_KIND, buildMessage, buildPayload, deepLink, isPushKind, type PushKind, type PushPayload } from "./topics";

// Churches & Ministries expansion, Phase 5B: the job that finds what is new, queues it, and sends it. Everything here runs on the SERVER with the service-role client, called only by the cron route after it
// checked the secret. It reads public church content and the visitors' own opt-ins; it writes nothing but the queue and the delivery notes.
//
//   discover(): looks for items published in the last 48 hours (announcement, group notice, event, testimony, care need, new product), today's Daily Word, and the daily Bible reading of every church that
//               offers it, and queues each ONCE (the queue is unique per church, kind and reference, so running it again, or two runs at once, queues nothing twice);
//   dispatch(): takes the notifications that are due, finds the recipients in the database (opted in to that topic, still connected, not yet notified, under the daily cap), builds a message in each
//               recipient's language from public text only, sends it, and notes it. A notification whose item was withdrawn meanwhile is skipped.
// Nothing here ever throws to the caller: a failing step is counted and the next one runs.

type Row = Record<string, any>;
export type Db = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };
export type Sender = (customerId: string, payload: { category: string; title: string; body: string; url?: string }) => Promise<boolean>;

const HOUR = 3_600_000;
export const LOOKBACK_MS = 48 * HOUR;
export const BATCH = 200;
export const MAX_BATCHES = 10;
const PER_KIND_LIMIT = 200;

/** 07:00 in Cameroon (UTC+1 all year) on the given Douala calendar day, as a timestamp. */
export const sevenAmDouala = (day: string): string => `${day}T06:00:00.000Z`;

export interface DiscoverResult {
  queued: Record<string, number>;
  errors: number;
}

async function enqueue(db: Db, profileId: string, kind: PushKind, ref: string, runAt: string, payload: Record<string, string>): Promise<boolean> {
  const { data, error } = await db.rpc("church_push_enqueue", { p_profile_id: profileId, p_kind: kind, p_ref: ref, p_run_at: runAt, p_payload: payload });
  return !error && data === true;
}

export async function discover(db: Db, now: number = Date.now()): Promise<DiscoverResult> {
  const queued: Record<string, number> = {};
  let errors = 0;
  const since = new Date(now - LOOKBACK_MS).toISOString();
  const today = doualaDate(now);
  const bump = (k: string) => (queued[k] = (queued[k] ?? 0) + 1);

  // the churches we may notify: username by profile id (a published, non-demo church page)
  const churches = new Map<string, string>();
  try {
    const { data, error } = await db.from("profiles").select("id, username, category, categories, published, is_demo").eq("published", true).limit(5000);
    if (error) throw error;
    for (const p of (data as Row[]) || []) {
      const church = p.category === "church_ministries" || (Array.isArray(p.categories) && p.categories.includes("church_ministries"));
      if (church && p.is_demo !== true && typeof p.username === "string") churches.set(p.id, p.username);
    }
  } catch {
    return { queued, errors: 1 };
  }
  const user = (profileId: string) => churches.get(profileId);

  const step = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch {
      errors += 1;
      console.error(JSON.stringify({ scope: "church_push", step: name, result: "discover_error" }));
    }
  };

  await step("announcements", async () => {
    const { data, error } = await db.from("ministry_announcements").select("id, profile_id, title_en, title_fr, public_group_id, expires_on").eq("status", "published").gte("published_at", since).limit(PER_KIND_LIMIT);
    if (error) throw error;
    const groupIds = Array.from(new Set(((data as Row[]) || []).map((r) => r.public_group_id).filter(Boolean)));
    const kinds = new Map<string, string>();
    if (groupIds.length) {
      const g = await db.from("church_public_groups").select("id, kind").in("id", groupIds);
      for (const r of (g.data as Row[]) || []) kinds.set(r.id, r.kind);
    }
    for (const r of (data as Row[]) || []) {
      const username = user(r.profile_id);
      if (!username || (r.expires_on && r.expires_on < today)) continue;
      const grouped = !!r.public_group_id;
      const path = deepLink(username, grouped ? "group_announcement" : "announcement", { groupKind: kinds.get(r.public_group_id) });
      const payload = buildPayload({ title_en: r.title_en, title_fr: r.title_fr, path, group_id: grouped ? r.public_group_id : null });
      if (await enqueue(db, r.profile_id, grouped ? "group_announcement" : "announcement", r.id, new Date(now).toISOString(), payload)) bump(grouped ? "group_announcement" : "announcement");
    }
  });

  await step("events", async () => {
    const { data, error } = await db.from("ministry_events").select("id, profile_id, title_en, title_fr, event_date, is_cancelled").eq("status", "published").gte("published_at", since).gte("event_date", today).limit(PER_KIND_LIMIT);
    if (error) throw error;
    for (const r of (data as Row[]) || []) {
      const username = user(r.profile_id);
      if (!username || r.is_cancelled === true) continue;
      if (await enqueue(db, r.profile_id, "event", r.id, new Date(now).toISOString(), buildPayload({ title_en: r.title_en, title_fr: r.title_fr, path: deepLink(username, "event") }))) bump("event");
    }
  });

  await step("testimonies", async () => {
    const { data, error } = await db
      .from("ministry_testimonies")
      .select("id, profile_id")
      .eq("review_status", "approved")
      .eq("publication_status", "published")
      .eq("publish_consent", true)
      .gte("published_at", since)
      .limit(PER_KIND_LIMIT);
    if (error) throw error;
    for (const r of (data as Row[]) || []) {
      const username = user(r.profile_id);
      // the notice never carries the testimony: no title, no words, no name
      if (username && (await enqueue(db, r.profile_id, "testimony", r.id, new Date(now).toISOString(), buildPayload({ path: deepLink(username, "testimony") })))) bump("testimony");
    }
  });

  await step("daily_word", async () => {
    const { data, error } = await db.from("daily_words").select("id, profile_id, title_en, title_fr").eq("status", "published").eq("publish_on", today).limit(PER_KIND_LIMIT);
    if (error) throw error;
    for (const r of (data as Row[]) || []) {
      const username = user(r.profile_id);
      if (username && (await enqueue(db, r.profile_id, "daily_word", r.id, sevenAmDouala(today), buildPayload({ title_en: r.title_en, title_fr: r.title_fr, path: deepLink(username, "daily_word") })))) bump("daily_word");
    }
  });

  await step("care", async () => {
    const { data, error } = await db.from("ministry_care_cases").select("id, profile_id, title_en, title_fr").eq("status", "published").eq("consent_state", "granted").gte("published_at", since).limit(PER_KIND_LIMIT);
    if (error) throw error;
    for (const r of (data as Row[]) || []) {
      const username = user(r.profile_id);
      if (username && (await enqueue(db, r.profile_id, "care", r.id, new Date(now).toISOString(), buildPayload({ title_en: r.title_en, title_fr: r.title_fr, path: deepLink(username, "care") })))) bump("care");
    }
  });

  await step("products", async () => {
    const { data, error } = await db.from("products").select("id, profile_id, name, created_at").gte("created_at", since).limit(PER_KIND_LIMIT);
    if (error) throw error;
    for (const r of (data as Row[]) || []) {
      const username = user(r.profile_id);
      if (!username || typeof r.name !== "string" || r.name.trim() === "") continue;
      if (await enqueue(db, r.profile_id, "product", r.id, new Date(now).toISOString(), buildPayload({ title_en: r.name, title_fr: r.name, path: deepLink(username, "product", { productId: r.id }) }))) bump("product");
    }
  });

  await step("bible_day", async () => {
    const { data, error } = await db.from("church_features").select("profile_id").eq("bible_year", true).limit(5000);
    if (error) throw error;
    for (const r of (data as Row[]) || []) {
      const username = user(r.profile_id);
      if (username && (await enqueue(db, r.profile_id, "bible_day", today, sevenAmDouala(today), buildPayload({ path: deepLink(username, "bible_day") })))) bump("bible_day");
    }
  });

  return { queued, errors };
}

export interface DispatchResult {
  claimed: number;
  sent: number;
  skipped: number;
  failed: number;
}

/** Is the item behind a queued notification still public? An announcement unpublished, a care case withdrawn, a Daily Word replaced: the notification is skipped. */
async function stillPublic(db: Db, row: Row): Promise<boolean> {
  const one = async (table: string, filter: (q: any) => any): Promise<boolean> => {
    const { data, error } = await filter(db.from(table).select("id").eq("id", row.ref)).maybeSingle();
    return !error && !!data;
  };
  switch (row.kind as PushKind) {
    case "announcement":
    case "group_announcement":
      return one("ministry_announcements", (q) => q.eq("status", "published"));
    case "event":
      return one("ministry_events", (q) => q.eq("status", "published"));
    case "testimony":
      return one("ministry_testimonies", (q) => q.eq("publication_status", "published").eq("publish_consent", true));
    case "daily_word":
      return one("daily_words", (q) => q.eq("status", "published"));
    case "care":
      return one("ministry_care_cases", (q) => q.eq("status", "published").eq("consent_state", "granted"));
    default:
      return true;
  }
}

export async function dispatch(db: Db, send: Sender, now: number = Date.now(), limit = 100, budgetMs = 45_000): Promise<DispatchResult> {
  const out: DispatchResult = { claimed: 0, sent: 0, skipped: 0, failed: 0 };
  const started = Date.now();
  const { data: claimed, error } = await db.rpc("church_push_claim", { p_limit: limit });
  if (error) {
    console.error(JSON.stringify({ scope: "church_push", result: "claim_error" }));
    return out;
  }
  const today = doualaDate(now);
  for (const row of ((claimed as Row[]) || [])) {
    out.claimed += 1;
    try {
      if (!isPushKind(row.kind)) {
        await db.rpc("church_push_finish", { p_outbox_id: row.id, p_status: "skipped" });
        out.skipped += 1;
        continue;
      }
      const { data: church } = await db.from("profiles").select("id, name, username, published, is_demo").eq("id", row.profile_id).maybeSingle();
      const c = church as Row | null;
      if (!c || c.published === false || c.is_demo === true || typeof c.username !== "string" || !(await stillPublic(db, row))) {
        await db.rpc("church_push_finish", { p_outbox_id: row.id, p_status: "skipped" });
        out.skipped += 1;
        continue;
      }
      const payload = (row.payload ?? {}) as PushPayload;
      let finished = true;
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        if (Date.now() - started > budgetMs) {
          finished = false; // left in "sending": it is released after 10 minutes and the next run carries on (nobody is notified twice)
          break;
        }
        const { data: people, error: e2 } = await db.rpc("church_push_recipients", { p_outbox_id: row.id, p_limit: BATCH });
        if (e2) {
          finished = false;
          out.failed += 1;
          break;
        }
        const list = (people as Row[]) || [];
        if (list.length === 0) break;
        for (const p of list) {
          const message = buildMessage({ kind: row.kind, lang: p.lang === "fr" ? "fr" : "en", church: { name: String(c.name || c.username), username: c.username }, payload, start: p.start_date ? String(p.start_date).slice(0, 10) : null, today });
          let delivered = false;
          if (message) {
            try {
              delivered = await send(p.customer_id, { category: "church", title: message.title, body: message.body, url: message.url });
            } catch {
              delivered = false;
            }
          }
          await db.rpc("church_push_record", { p_outbox_id: row.id, p_customer_id: p.customer_id, p_delivered: delivered });
          if (delivered) out.sent += 1;
          else out.failed += 1;
        }
        if (list.length < BATCH) break;
      }
      if (finished) await db.rpc("church_push_finish", { p_outbox_id: row.id, p_status: "sent" });
    } catch {
      out.failed += 1;
      console.error(JSON.stringify({ scope: "church_push", result: "dispatch_error" }));
    }
  }
  return out;
}

export { TOPIC_OF_KIND };
