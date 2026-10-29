import { CONSENT_CHANNELS, grantConsent, isConsentChannel, isConsentUuid, loadConsentItems, withdrawConsent, type ConsentDb, type ConsentItem, type EnsureMember } from "./consent";

// The My Ringo consent API as plain functions (the route in src/app/api/customer/consent wraps them): what a connected customer has agreed to, per profile and per channel, and the switch to
// agree or to withdraw. The customer ALWAYS comes from the verified My Ringo cookie (never from the request); a profile id in a request is only a lookup key and must be one this customer is
// connected to. Nothing here sends a message. There is no WhatsApp channel.

export interface ConsentCtx {
  customer: { id: string; name: string; email: string; phone: string | null; email_verified_at: string | null };
  db: ConsentDb;
  ensureMember: EnsureMember;
}
export type ConsentResult = { status: number; body: Record<string, unknown> };

const ok = (body: Record<string, unknown> = {}, status = 200): ConsentResult => ({ status, body: { ok: true, ...body } });
const fail = (status: number, error: string, field?: string): ConsentResult => ({ status, body: { ok: false, error, ...(field ? { field } : {}) } });
const emailConfirmed = (c: ConsentCtx["customer"]) => !!c.email_verified_at;

const shape = (i: ConsentItem) => ({
  profile_id: i.profile_id,
  profile_name: i.profile_name,
  email: { on: i.email.effective, state: i.email.state, basis: i.email.basis, reason: i.email.reason },
  push: { on: i.push.effective, state: i.push.state, basis: i.push.basis, reason: i.push.reason },
});

export async function getConsent(ctx: ConsentCtx): Promise<ConsentResult> {
  const { items, ledgerAvailable } = await loadConsentItems(ctx.db, { id: ctx.customer.id, emailConfirmed: emailConfirmed(ctx.customer) });
  return ok({ items: items.map(shape), channels: [...CONSENT_CHANNELS], email_confirmed: emailConfirmed(ctx.customer), ledger_available: ledgerAvailable });
}

/** PUT { profile_id, channel: "email" | "push", enabled: boolean } */
export async function putConsent(ctx: ConsentCtx, body: unknown): Promise<ConsentResult> {
  const b = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  if (!b) return fail(400, "invalid_body");
  for (const k of Object.keys(b)) if (!["profile_id", "channel", "enabled"].includes(k)) return fail(400, "unexpected_field", k);
  if (!isConsentUuid(b.profile_id)) return fail(400, "invalid_profile", "profile_id");
  if (!isConsentChannel(b.channel)) return fail(400, "invalid_channel", "channel");
  if (typeof b.enabled !== "boolean") return fail(400, "invalid_body", "enabled");
  const profileId = b.profile_id;
  const channel = b.channel;

  // only a profile this customer is connected to can be written (a withdrawal is allowed for any existing connection)
  const { data: conn } = await ctx.db.from("customer_connections").select("id, status").eq("customer_id", ctx.customer.id).eq("profile_id", profileId).maybeSingle();
  if (!conn) return fail(404, "not_connected");

  let ledgerRecorded = true;
  if (b.enabled) {
    if (conn.status !== "active") return fail(409, "not_connected");
    const granted = await grantConsent(
      ctx.db,
      { customer: { id: ctx.customer.id, name: ctx.customer.name, email: ctx.customer.email, phone: ctx.customer.phone, emailConfirmed: emailConfirmed(ctx.customer) }, profileId, channel, source: "my_ringo" },
      ctx.ensureMember
    );
    if (!granted.ok) return granted.code === "not_connected" ? fail(409, "not_connected") : fail(503, "consent_unavailable");
  } else {
    const done = await withdrawConsent(ctx.db, { customerId: ctx.customer.id, profileId, channel, source: "my_ringo" });
    ledgerRecorded = done.ledgerRecorded;
  }

  const { items } = await loadConsentItems(ctx.db, { id: ctx.customer.id, emailConfirmed: emailConfirmed(ctx.customer) });
  const item = items.find((i) => i.profile_id === profileId);
  return ok({ item: item ? shape(item) : null, ledger_recorded: ledgerRecorded });
}
