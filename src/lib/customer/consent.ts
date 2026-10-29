// Customer marketing consent (Phase 3A): the ONE place that decides whether a connected customer has agreed to marketing updates from a profile, per channel (email, push), and the only place that
// records or withdraws that agreement.
//
// WHAT IDENTIFIES WHAT. A consent belongs to (customer = ringo_customers.id, profile = profiles.id, channel). The connection is customer_connections (unique per customer + profile). The Community
// row is community_subscribers (unique per profile + email), reached from the connection through customer_connections.community_subscriber_id, with its delivery switches in
// community_subscription_preferences (email_updates, push_updates). The unsubscribe link carries a subscriber token, so a subscriber is mapped BACK to its connection(s) the same way.
//
// WHERE THE FACTS LIVE.
//   * customer_consent_events (2027-01-17)   the append-only record of decisions: granted / revoked, channel, source. A revoke here VETOES everything below.
//   * customer_connections.marketing_consent the EMAIL flag, kept in step by the database writer. Rows that were set before the ledger existed are LEGACY consent: still honoured, still revocable.
//   * community_subscribers.status           'unsubscribed' / 'removed' end every channel.
//   * community_subscription_preferences     what the sender actually reads (email_updates, push_updates). This is delivery plumbing, not the decision.
//
// THE RULE (decideConsent, pure): a decision is "on" only when the connection is active, no later REVOKE exists, the Community row is not unsubscribed or removed, and the switch the sender reads is on.
//   * EMAIL  needs the flag marketing_consent. Two kinds of flag exist:
//       - LEGACY (set before the ledger existed; no grant event): honoured only while the email switch the sender reads is ALREADY on. A legacy flag is never used to turn that switch on again,
//         because by itself it cannot tell "not applied yet" from "switched off since" - there is no timing guess here, the switch simply has to be on.
//       - LEDGER (the latest event is a grant): the flag was set by the database writer, and every email withdrawal clears it (or records a revoke), so a ledger grant whose switch is still off is
//         genuinely waiting to be applied (for example for an address that is not confirmed yet).
//   * PUSH   needs a ledger GRANT and the switch on. A Community row's push_updates default (true) is how push has always been delivered to members; it is NOT counted as marketing consent here.
//   "pending" means a LEDGER grant is valid but its switch has not been applied yet. Only a "pending" decision may be applied by synchronisation; an "off" decision can never be switched back on
//   by anything except a NEW explicit grant. That is what stops an unsubscribe from being undone by a stale flag or by confirming an email address.
//
// FAIL CLOSED / FAIL SAFE. Granting needs the ledger: if the database writer cannot record the event, nothing is switched on. Withdrawing never needs it: if the writer fails the live switches are still
// cleared (the flag, and the Community switch), so a withdrawal always works even while the ledger is unavailable.
//
// This module sends nothing. There is no WhatsApp channel.

export const CONSENT_CHANNELS = ["email", "push"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];
export const CONSENT_SOURCES = ["connect_form", "my_ringo", "community_unsubscribe", "community_manage", "reconnect_reset"] as const;
export type ConsentSource = (typeof CONSENT_SOURCES)[number];
export const CONSENT_NOTICE_VERSION = 1;

export const isConsentChannel = (v: unknown): v is ConsentChannel => typeof v === "string" && (CONSENT_CHANNELS as readonly string[]).includes(v);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isConsentUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export type ConsentDb = { from(table: string): any; rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: any }> };
type Row = Record<string, any>;

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// The rule
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export type LedgerAction = "granted" | "revoked";
export type ConsentState = "on" | "pending" | "off";
export type ConsentBasis = "ledger" | "legacy" | "none";
export type ConsentReason =
  | "ok"
  | "not_connected"
  | "no_consent"
  | "revoked"
  | "unsubscribed"
  | "removed_by_creator"
  | "legacy_not_applied"
  | "switched_off"
  | "email_unconfirmed"
  | "not_applied"
  | "no_community_row";

export interface ConsentFacts {
  channel: ConsentChannel;
  connection: { status: string; marketing_consent: boolean } | null;
  emailConfirmed: boolean;
  subscriber: { status: string; created_at: string | null } | null;
  prefs: { email_updates: boolean | null; push_updates: boolean | null; updated_at: string | null } | null;
  /** The most recent ledger decision for this customer, profile and channel; null = none (or the ledger is unavailable). */
  latest: LedgerAction | null;
}

export interface ConsentDecision {
  state: ConsentState;
  effective: boolean;
  basis: ConsentBasis;
  reason: ConsentReason;
}

const out = (state: ConsentState, basis: ConsentBasis, reason: ConsentReason): ConsentDecision => ({ state, effective: state === "on", basis, reason });

export function decideConsent(f: ConsentFacts): ConsentDecision {
  const basisOf = (): ConsentBasis => (f.latest === "granted" ? "ledger" : "legacy");
  if (!f.connection || f.connection.status !== "active") return out("off", f.latest ? "ledger" : "none", "not_connected");
  if (f.latest === "revoked") return out("off", "ledger", "revoked");
  const sub = f.subscriber;
  const subscriberOff = (basis: ConsentBasis): ConsentDecision | null =>
    sub && sub.status === "removed" ? out("off", basis, "removed_by_creator") : sub && sub.status !== "active" ? out("off", basis, "unsubscribed") : null;

  if (f.channel === "email") {
    if (f.connection.marketing_consent !== true) return out("off", "none", "no_consent");
    const basis = basisOf();
    const gone = subscriberOff(basis);
    if (gone) return gone;
    if (basis === "legacy") {
      // never used to switch anything on: the sender's switch must already be on
      if (!sub || !f.prefs || f.prefs.email_updates !== true) return out("off", basis, "legacy_not_applied");
      return f.emailConfirmed ? out("on", basis, "ok") : out("pending", basis, "email_unconfirmed");
    }
    if (!f.emailConfirmed) return out("pending", basis, "email_unconfirmed");
    if (!sub) return out("pending", basis, "no_community_row");
    if (f.prefs && f.prefs.email_updates === false) return out("pending", basis, "not_applied");
    return out("on", basis, "ok");
  }

  // push
  if (f.latest !== "granted") return out("off", "none", "no_consent");
  const gone = subscriberOff("ledger");
  if (gone) return gone;
  if (!sub) return out("pending", "ledger", "no_community_row");
  // A push withdrawal has no flag of its own besides this switch, so a switch that is off is OFF (never "waiting"): a grant is applied in the same request that records it, and
  // an explicit new grant is the only thing that turns it back on. This keeps a withdrawal made while the ledger was unavailable from reading as consent after recovery.
  if (f.prefs && f.prefs.push_updates === false) return out("off", "ledger", "switched_off");
  return out("on", "ledger", "ok");
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface ConsentItem {
  profile_id: string;
  profile_name: string;
  email: ConsentDecision;
  push: ConsentDecision;
}

/** Every ACTIVE connection of this customer with the decision for each channel. `customerId` must come from the verified My Ringo session. */
export async function loadConsentItems(
  db: ConsentDb,
  customer: { id: string; emailConfirmed: boolean },
  opts: { publishedOnly?: boolean } = {}
): Promise<{ items: ConsentItem[]; ledgerAvailable: boolean }> {
  const { data: conns, error: connError } = await db
    .from("customer_connections")
    .select("id, profile_id, status, marketing_consent, community_subscriber_id, connected_at")
    .eq("customer_id", customer.id)
    .eq("status", "active")
    .order("connected_at", { ascending: false })
    .limit(100);
  if (connError || !Array.isArray(conns) || conns.length === 0) return { items: [], ledgerAvailable: true };

  const { data: profileRows } = await db.from("profiles").select("id, name, username, published").in("id", (conns as Row[]).map((c) => c.profile_id));
  const profiles = new Map<string, Row>(((profileRows || []) as Row[]).map((p) => [p.id as string, p]));

  const latest = new Map<string, LedgerAction>();
  let ledgerAvailable = true;
  const { data: events, error: eventsError } = await db
    .from("customer_consent_events")
    .select("profile_id, channel, action, seq")
    .eq("customer_id", customer.id)
    .order("seq", { ascending: false })
    .limit(2000);
  if (eventsError || !Array.isArray(events)) ledgerAvailable = false;
  else for (const e of events as Row[]) if (!latest.has(`${e.profile_id}:${e.channel}`)) latest.set(`${e.profile_id}:${e.channel}`, e.action);

  const subscriberIds = (conns as Row[]).map((c) => c.community_subscriber_id).filter((x): x is string => typeof x === "string");
  const subs = new Map<string, Row>();
  const prefs = new Map<string, Row>();
  if (subscriberIds.length > 0) {
    const { data: rows } = await db.from("community_subscribers").select("id, status, created_at").in("id", subscriberIds);
    for (const r of (rows || []) as Row[]) subs.set(r.id, r);
    // all columns: push_updates may not exist yet on an old database
    const { data: prows } = await db.from("community_subscription_preferences").select("*").in("subscriber_id", subscriberIds);
    for (const r of (prows || []) as Row[]) prefs.set(r.subscriber_id, r);
  }

  const items: ConsentItem[] = [];
  for (const c of conns as Row[]) {
    const profile = profiles.get(c.profile_id);
    // the screen lists only profiles whose public page exists; applying a confirmed address must reach every connection
    if (opts.publishedOnly !== false && (!profile || profile.published !== true)) continue;
    const s = c.community_subscriber_id ? subs.get(c.community_subscriber_id) ?? null : null;
    const p = c.community_subscriber_id ? prefs.get(c.community_subscriber_id) ?? null : null;
    const facts = (channel: ConsentChannel): ConsentFacts => ({
      channel,
      connection: { status: c.status, marketing_consent: c.marketing_consent === true },
      emailConfirmed: customer.emailConfirmed,
      subscriber: s ? { status: s.status, created_at: s.created_at ?? null } : null,
      prefs: p ? { email_updates: p.email_updates ?? null, push_updates: p.push_updates ?? null, updated_at: p.updated_at ?? null } : null,
      latest: latest.get(`${c.profile_id}:${channel}`) ?? null,
    });
    items.push({ profile_id: c.profile_id as string, profile_name: String(profile?.name || profile?.username || ""), email: decideConsent(facts("email")), push: decideConsent(facts("push")) });
  }
  return { items, ledgerAvailable };
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export type RecordResult = { ok: true; changed: boolean } | { ok: false; code: "not_connected" | "ledger_unavailable" };

/** Appends one decision through the database writer (service role only). Never throws. A withdrawal is tried twice, so a momentary failure does not leave an older grant as the latest decision. */
export async function recordConsent(db: ConsentDb, a: { customerId: string; profileId: string; channel: ConsentChannel; action: LedgerAction; source: ConsentSource }): Promise<RecordResult> {
  const first = await recordOnce(db, a);
  if (first.ok || first.code !== "ledger_unavailable" || a.action !== "revoked") return first;
  return recordOnce(db, a);
}

async function recordOnce(db: ConsentDb, a: { customerId: string; profileId: string; channel: ConsentChannel; action: LedgerAction; source: ConsentSource }): Promise<RecordResult> {
  try {
    const { data, error } = await db.rpc("customer_consent_set", { p_customer: a.customerId, p_profile: a.profileId, p_channel: a.channel, p_action: a.action, p_source: a.source });
    if (error) {
      if (/consent_not_connected/.test(String(error.message || ""))) return { ok: false, code: "not_connected" };
      return { ok: false, code: "ledger_unavailable" };
    }
    const row = Array.isArray(data) ? data[0] : data;
    return { ok: true, changed: row?.out_changed === true };
  } catch {
    return { ok: false, code: "ledger_unavailable" };
  }
}

/** The most recent ledger decision for one customer, profile and channel (null = none, or the ledger cannot be read). */
export async function latestDecision(db: ConsentDb, customerId: string, profileId: string, channel: ConsentChannel): Promise<LedgerAction | null> {
  try {
    const { data, error } = await db.from("customer_consent_events").select("action").eq("customer_id", customerId).eq("profile_id", profileId).eq("channel", channel).order("seq", { ascending: false }).limit(1);
    if (error || !Array.isArray(data) || data.length === 0) return null;
    return data[0].action === "granted" || data[0].action === "revoked" ? data[0].action : null;
  } catch {
    return null;
  }
}

/**
 * The enforcement point for ANNOUNCEMENT senders (the Community email / push fan-out; never the transactional order, booking, ticket or loyalty notifications, which are not marketing).
 * Of the given Community subscribers of one profile, those whose linked customer has a ledger WITHDRAWAL as the latest decision for the channel. A withdrawn customer is skipped even if a stale
 * delivery default (push_updates is true for new members) says otherwise. It only ever REMOVES recipients: a subscriber with no linked customer, no decision, or a grant is not touched, so
 * behaviour for everyone who never used the ledger is unchanged. If the ledger cannot be read nothing is vetoed (a withdrawal also clears the live switches, so it is not lost).
 */
export async function withdrawnSubscribers(db: ConsentDb, profileId: string, subscriberIds: readonly string[], channel: ConsentChannel): Promise<Set<string>> {
  const vetoed = new Set<string>();
  if (subscriberIds.length === 0) return vetoed;
  try {
    const { data: links, error } = await db.from("customer_connections").select("customer_id, community_subscriber_id").eq("profile_id", profileId).in("community_subscriber_id", [...subscriberIds]);
    if (error || !Array.isArray(links) || links.length === 0) return vetoed;
    const customers = [...new Set((links as Row[]).map((l) => l.customer_id as string))];
    const { data: events, error: eventsError } = await db
      .from("customer_consent_events")
      .select("customer_id, action, seq")
      .eq("profile_id", profileId)
      .eq("channel", channel)
      .in("customer_id", customers)
      .order("seq", { ascending: false });
    if (eventsError || !Array.isArray(events)) return vetoed;
    const latest = new Map<string, string>();
    for (const e of events as Row[]) if (!latest.has(e.customer_id)) latest.set(e.customer_id, e.action);
    for (const l of links as Row[]) if (latest.get(l.customer_id) === "revoked") vetoed.add(l.community_subscriber_id as string);
  } catch {
    /* nothing is vetoed when the ledger cannot be read */
  }
  return vetoed;
}

const nowIso = () => new Date().toISOString();

async function readConnection(db: ConsentDb, customerId: string, profileId: string): Promise<Row | null> {
  const { data } = await db.from("customer_connections").select("id, status, marketing_consent, community_subscriber_id").eq("customer_id", customerId).eq("profile_id", profileId).maybeSingle();
  return (data as Row | null) ?? null;
}

/** Turns one Community switch off. The push_updates column may not exist yet on an old database, so it is written on its own. */
async function switchOff(db: ConsentDb, subscriberId: string, channel: ConsentChannel): Promise<void> {
  const patch = channel === "email" ? { email_updates: false, updated_at: nowIso() } : { push_updates: false };
  const { error } = await db.from("community_subscription_preferences").update(patch).eq("subscriber_id", subscriberId);
  if (error) console.error("consent: could not switch a community preference off:", String(error.message || "").slice(0, 160));
}

export type WithdrawResult = { ok: true; ledgerRecorded: boolean };

/**
 * Withdraws consent for one channel. ALWAYS takes effect: if the ledger cannot record the event the live switches are still cleared (the email flag, and the Community switch the sender reads).
 * Works for a disconnected customer, too, and is idempotent.
 */
export async function withdrawConsent(db: ConsentDb, a: { customerId: string; profileId: string; channel: ConsentChannel; source: ConsentSource }): Promise<WithdrawResult> {
  const recorded = await recordConsent(db, { ...a, action: "revoked" });
  const ledgerRecorded = recorded.ok;
  const conn = await readConnection(db, a.customerId, a.profileId);
  if (!conn) return { ok: true, ledgerRecorded };
  if (!recorded.ok && a.channel === "email") {
    await db.from("customer_connections").update({ marketing_consent: false, marketing_consent_at: null, updated_at: nowIso() }).eq("id", conn.id);
  }
  if (conn.community_subscriber_id) await switchOff(db, conn.community_subscriber_id, a.channel);
  return { ok: true, ledgerRecorded };
}

/** Withdraws BOTH channels (an unsubscribe, or the reset a reconnect performs). */
export async function withdrawAll(db: ConsentDb, a: { customerId: string; profileId: string; source: ConsentSource }): Promise<void> {
  for (const channel of CONSENT_CHANNELS) await withdrawConsent(db, { ...a, channel });
}

/** An unsubscribe link or preference change names a Community subscriber: withdraw consent for the connection(s) that point at it. */
export async function withdrawForSubscriber(db: ConsentDb, subscriberId: string, channels: readonly ConsentChannel[], source: ConsentSource): Promise<void> {
  const { data } = await db.from("customer_connections").select("customer_id, profile_id").eq("community_subscriber_id", subscriberId);
  for (const c of (data || []) as Row[]) for (const channel of channels) await withdrawConsent(db, { customerId: c.customer_id, profileId: c.profile_id, channel, source });
}

export type EnsureMember = (
  db: any,
  input: { connectionId: string; customer: { name: string; email: string; phone: string | null }; profileId: string; emailUpdates: boolean }
) => Promise<void>;

export type GrantResult = { ok: true } | { ok: false; code: "not_connected" | "ledger_unavailable" };

/**
 * Grants consent for one channel, from an explicit action of the signed-in customer (or the Stay Connected tick). FAILS CLOSED: nothing is switched on unless the ledger recorded the decision.
 * The Community switch the sender reads is applied afterwards - and only when the address is confirmed (email) - and a row the person themselves had unsubscribed is reactivated only by this
 * explicit new grant.
 */
export async function grantConsent(
  db: ConsentDb,
  a: { customer: { id: string; name: string; email: string; phone: string | null; emailConfirmed: boolean }; profileId: string; channel: ConsentChannel; source: ConsentSource },
  ensureMember: EnsureMember
): Promise<GrantResult> {
  const recorded = await recordConsent(db, { customerId: a.customer.id, profileId: a.profileId, channel: a.channel, action: "granted", source: a.source });
  if (!recorded.ok) return recorded;
  const conn = await readConnection(db, a.customer.id, a.profileId);
  if (!conn || conn.status !== "active") return { ok: true };
  const applyEmail = a.channel === "email";
  if (applyEmail && !a.customer.emailConfirmed) return { ok: true }; // recorded; applied by synchronisation once the address is confirmed

  let subscriberId: string | null = conn.community_subscriber_id ?? null;
  if (!subscriberId) {
    await ensureMember(db, { connectionId: conn.id, customer: a.customer, profileId: a.profileId, emailUpdates: applyEmail });
    subscriberId = (await readConnection(db, a.customer.id, a.profileId))?.community_subscriber_id ?? null;
  }
  if (!subscriberId && a.customer.emailConfirmed) subscriberId = await relinkUnsubscribed(db, conn.id, a.profileId, a.customer.email);
  if (!subscriberId) return { ok: true };

  const { data: sub } = await db.from("community_subscribers").select("id, status").eq("id", subscriberId).maybeSingle();
  if (!sub || sub.status === "removed") return { ok: true }; // a creator's removal is theirs to undo
  if (sub.status !== "active" && a.customer.emailConfirmed) await db.from("community_subscribers").update({ status: "active", updated_at: nowIso() }).eq("id", subscriberId);
  const patch = applyEmail ? { email_updates: true, updated_at: nowIso() } : { push_updates: true, updated_at: nowIso() };
  const { error } = await db.from("community_subscription_preferences").update(patch).eq("subscriber_id", subscriberId);
  if (error && !applyEmail) await db.from("community_subscription_preferences").update({ push_updates: true }).eq("subscriber_id", subscriberId);
  return { ok: true };
}

/** The customer's own earlier row for this profile + address that they had unsubscribed from: link it again so that a NEW explicit grant can take effect. */
async function relinkUnsubscribed(db: ConsentDb, connectionId: string, profileId: string, email: string): Promise<string | null> {
  const { data } = await db.from("community_subscribers").select("id, status").eq("profile_id", profileId).ilike("email", email.replace(/[\\%_]/g, (m) => `\\${m}`)).maybeSingle();
  if (!data || data.status !== "unsubscribed") return null;
  const { data: taken } = await db.from("customer_connections").select("id").eq("community_subscriber_id", data.id).neq("id", connectionId).limit(1);
  if (taken && taken.length > 0) return null;
  const { error } = await db.from("customer_connections").update({ community_subscriber_id: data.id, updated_at: nowIso() }).eq("id", connectionId);
  return error ? null : (data.id as string);
}

/**
 * After the address is confirmed: applies the email decisions that are valid but not applied yet ("pending"). A decision that is "off" for any reason (revoked, unsubscribed, removed, switched off
 * later) is NEVER switched back on here.
 */
export async function applyPendingEmail(db: ConsentDb, customer: { id: string; name: string; email: string; phone: string | null }, ensureMember: EnsureMember): Promise<void> {
  const { items } = await loadConsentItems(db, { id: customer.id, emailConfirmed: true }, { publishedOnly: false });
  for (const item of items) {
    if (item.email.state !== "pending" || item.email.reason === "email_unconfirmed") continue;
    const conn = await readConnection(db, customer.id, item.profile_id);
    if (!conn || conn.status !== "active") continue;
    if (conn.community_subscriber_id) {
      await db.from("community_subscription_preferences").update({ email_updates: true, updated_at: nowIso() }).eq("subscriber_id", conn.community_subscriber_id);
    } else {
      await ensureMember(db, { connectionId: conn.id, customer, profileId: item.profile_id, emailUpdates: true });
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// One profile, many customers (the promotion sender and the segment audience preview)
// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

export interface AudienceMember {
  customerId: string;
  name: string;
  email: string;
  language: "en" | "fr";
  /** The Community unsubscribe token of this customer's row at this profile (the link every marketing email carries); null when there is no row. */
  manageToken: string | null;
  email_decision: ConsentDecision;
  push_decision: ConsentDecision;
}

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * The effective consent of the given customers for ONE profile, decided by the same rule (decideConsent) as everything else. Nothing is inferred from a purchase, a membership or a
 * connection: a customer is reachable on a channel only when the rule says "on". Server side only (service role); it returns contact details to the sender, never to a browser.
 */
export async function loadProfileAudience(db: ConsentDb, profileId: string, customerIds: readonly string[]): Promise<Map<string, AudienceMember>> {
  const result = new Map<string, AudienceMember>();
  for (const ids of chunk([...new Set(customerIds)], 150)) {
    const { data: conns } = await db.from("customer_connections").select("customer_id, status, marketing_consent, community_subscriber_id").eq("profile_id", profileId).eq("status", "active").in("customer_id", ids);
    if (!Array.isArray(conns) || conns.length === 0) continue;
    const { data: customers } = await db.from("ringo_customers").select("id, name, email, preferred_language, email_verified_at").in("id", ids);
    const byId = new Map<string, Row>(((customers || []) as Row[]).map((c) => [c.id as string, c]));
    const latest = new Map<string, LedgerAction>();
    const { data: events } = await db.from("customer_consent_events").select("customer_id, channel, action, seq").eq("profile_id", profileId).in("customer_id", ids).order("seq", { ascending: false });
    for (const e of (Array.isArray(events) ? events : []) as Row[]) if (!latest.has(`${e.customer_id}:${e.channel}`)) latest.set(`${e.customer_id}:${e.channel}`, e.action);
    const subIds = (conns as Row[]).map((c) => c.community_subscriber_id).filter((x): x is string => typeof x === "string");
    const subs = new Map<string, Row>();
    const prefs = new Map<string, Row>();
    if (subIds.length > 0) {
      const { data: srows } = await db.from("community_subscribers").select("id, status, created_at, unsubscribe_token").in("id", subIds);
      for (const r of (srows || []) as Row[]) subs.set(r.id, r);
      const { data: prows } = await db.from("community_subscription_preferences").select("*").in("subscriber_id", subIds);
      for (const r of (prows || []) as Row[]) prefs.set(r.subscriber_id, r);
    }
    for (const c of conns as Row[]) {
      const customer = byId.get(c.customer_id);
      if (!customer) continue;
      const s = c.community_subscriber_id ? subs.get(c.community_subscriber_id) ?? null : null;
      const p = c.community_subscriber_id ? prefs.get(c.community_subscriber_id) ?? null : null;
      const facts = (channel: ConsentChannel): ConsentFacts => ({
        channel,
        connection: { status: c.status, marketing_consent: c.marketing_consent === true },
        emailConfirmed: !!customer.email_verified_at,
        subscriber: s ? { status: s.status, created_at: s.created_at ?? null } : null,
        prefs: p ? { email_updates: p.email_updates ?? null, push_updates: p.push_updates ?? null, updated_at: p.updated_at ?? null } : null,
        latest: latest.get(`${c.customer_id}:${channel}`) ?? null,
      });
      result.set(c.customer_id, {
        customerId: c.customer_id,
        name: String(customer.name || ""),
        email: String(customer.email || ""),
        language: customer.preferred_language === "fr" ? "fr" : "en",
        manageToken: s?.unsubscribe_token ?? null,
        email_decision: decideConsent(facts("email")),
        push_decision: decideConsent(facts("push")),
      });
    }
  }
  return result;
}
