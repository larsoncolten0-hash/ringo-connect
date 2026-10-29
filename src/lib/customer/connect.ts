// Connect logic shared by /api/customer/connect (already signed in),
// /api/customer/connect/register (brand-new customer, no email code) and
// /api/customer/connect/verify (existing customer proving the email with a code).
//
// RULES (approved Phase 2 decisions — see the Connect design thread):
//  * Connecting makes the customer a member of that creator's community (a
//    community_subscribers row, linked from customer_connections), so the creator
//    can reach them with community push. Membership alone grants NO email/WhatsApp
//    consent: only an explicit marketing tick turns email_updates on, and only once
//    the email is confirmed. Push reaches the customer's own My Ringo devices.
//  * A pre-existing row that is unsubscribed/removed is never reactivated, and a
//    row is never edited or treated as consent beyond the rules above.
//  * Marketing consent (customer_connections.marketing_consent) is
//    independent of connection status and defaults to false.
//  * An existing customer's saved name/phone are never overwritten.
//  * A NEW customer is created straight from the form with email_verified_at NULL
//    (confirming the email is optional). An email that already has an account is
//    never signed into without a code — see createUnconfirmedCustomer.
//  * Marketing consent typed against an UNCONFIRMED email is recorded on the
//    connection but is NOT turned into a creator's community_subscribers row until
//    the email is confirmed (otherwise anyone could subscribe someone else's
//    address to marketing). See syncMarketingSubscribers.

// Rejects whitespace, a second "@", and the characters that let an address be
// parsed as a display-name / recipient list: < > , ; " ( )
export const EMAIL_RE = /^[^\s@<>,;"()]+@[^\s@<>,;"()]+\.[^\s@<>,;"()]+$/;
export const PHONE_RE = /^\+?[0-9][0-9\s().-]{5,39}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

import { applyPendingEmail, grantConsent, latestDecision, recordConsent, withdrawConsent } from "./consent";

export type ConnectableProfile = { id: string; name: string | null; username: string };

/** The profile is always re-read server-side — a profile id from the
 *  client is only ever a lookup key, never trusted for anything else. */
export async function getConnectableProfile(admin: any, profileId: unknown): Promise<ConnectableProfile | null> {
  if (!isUuid(profileId)) return null;
  const { data } = await admin
    .from("profiles")
    .select("id, name, username")
    .eq("id", profileId)
    .eq("published", true)
    .maybeSingle();
  return (data as ConnectableProfile | null) ?? null;
}

/** Create-or-reuse the ONE customer identity for a VERIFIED email. Never
 *  overwrites saved name/phone; only fills a phone that was empty. */
export async function upsertVerifiedCustomer(
  admin: any,
  input: { email: string; name: string; phone: string | null; language: "en" | "fr" | null }
): Promise<{ id: string; name: string; wasUnconfirmed: boolean } | null> {
  const now = new Date().toISOString();

  const find = () =>
    admin
      .from("ringo_customers")
      .select("id, name, phone, preferred_language, email_verified_at")
      .eq("email", input.email)
      .maybeSingle();

  let { data: existing } = await find();

  if (!existing) {
    const { data: created, error } = await admin
      .from("ringo_customers")
      .insert({
        email: input.email,
        name: input.name,
        phone: input.phone,
        preferred_language: input.language,
        // A code was just confirmed, so this email is proven. (Set explicitly: the
        // column no longer defaults to "now".)
        email_verified_at: now,
        last_login_at: now,
      })
      .select("id, name")
      .single();
    if (created) return { ...created, wasUnconfirmed: false };
    // Lost a race with a parallel verification of the same email — reuse
    // that row instead of failing (the unique email index guarantees one).
    if (error?.code !== "23505") {
      console.error("ringo_customers insert failed:", error?.message);
      return null;
    }
    ({ data: existing } = await find());
    if (!existing) return null;
  }

  const patch: Record<string, unknown> = { last_login_at: now, updated_at: now };
  // Entering the emailed code proves ownership of the address. If the account had
  // been created without confirming it, it is confirmed now — and the CALLER must
  // revoke that account's other sessions (whoever created it never proved the email).
  const wasUnconfirmed = !existing.email_verified_at;
  if (wasUnconfirmed) patch.email_verified_at = now;
  if (!existing.phone && input.phone) patch.phone = input.phone;
  if (!existing.preferred_language && input.language) patch.preferred_language = input.language;
  await admin.from("ringo_customers").update(patch).eq("id", existing.id);

  return { id: existing.id, name: existing.name, wasUnconfirmed };
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

export async function connectCustomerToProfile(
  admin: any,
  input: {
    customer: { id: string; name: string; email: string; phone: string | null; emailConfirmed: boolean };
    profile: ConnectableProfile;
    marketingConsent: boolean;
    source: string;
  }
): Promise<{ ok: boolean; consentRecorded?: boolean }> {
  const { customer, profile } = input;
  const now = new Date().toISOString();

  const readConnection = async () => {
    const { data } = await admin
      .from("customer_connections")
      .select("id, status, marketing_consent, community_subscriber_id")
      .eq("customer_id", customer.id)
      .eq("profile_id", profile.id)
      .maybeSingle();
    return data as { id: string; status: string; marketing_consent: boolean; community_subscriber_id: string | null } | null;
  };

  let existing = await readConnection();

  let connectionId: string;
  let existingSubscriberId: string | null = null;

  if (!existing) {
    const { data: created, error } = await admin
      .from("customer_connections")
      .insert({
        customer_id: customer.id,
        profile_id: profile.id,
        source: input.source,
        // consent is never written here: an explicit tick is granted below, through the consent ledger
        marketing_consent: false,
        marketing_consent_at: null,
      })
      .select("id")
      .single();
    if (created) {
      connectionId = created.id;
    } else {
      if (error?.code !== "23505") {
        console.error("customer_connections insert failed:", error?.message);
        return { ok: false };
      }
      // Lost a race with a parallel Connect for the same customer/profile.
      // The unique (customer, profile) pair guarantees a single row; re-read
      // the winner's row and fall through to process THIS request's own
      // consent below, exactly as for any already-existing connection.
      existing = await readConnection();
      if (!existing) return { ok: false };
      connectionId = existing.id;
    }
  } else {
    connectionId = existing.id;
  }

  if (existing) {
    existingSubscriberId = existing.community_subscriber_id;
    if (existing.status === "disconnected") {
      // Reconnecting never silently restores an old opt-in: consent comes
      // only from the explicit tick made in THIS request. The reset is written to the consent
      // ledger (email is also switched off on the old Community row, so the row that is linked
      // again below cannot carry the old opt-in back; an earlier push grant is vetoed).
      await withdrawConsent(admin, { customerId: customer.id, profileId: profile.id, channel: "email", source: "reconnect_reset" });
      // (an earlier EXPLICIT push grant is vetoed; push as plain Community membership, which never had a decision, is left as it always was)
      if ((await latestDecision(admin, customer.id, profile.id, "push")) === "granted") {
        await recordConsent(admin, { customerId: customer.id, profileId: profile.id, channel: "push", action: "revoked", source: "reconnect_reset" });
      }
      await admin
        .from("customer_connections")
        .update({
          status: "active",
          disconnected_at: null,
          marketing_consent: false,
          marketing_consent_at: null,
          community_subscriber_id: null,
          updated_at: now,
        })
        .eq("id", connectionId);
      existingSubscriberId = null;
    }
  }

  // Only THIS request's explicit tick can turn consent on (email); an existing opt-in is left as-is
  // and a missing tick never changes anything. FAILS CLOSED: if the consent ledger cannot record the
  // grant, nothing is switched on (the connection itself still succeeds).
  let consentRecorded = false;
  if (input.marketingConsent) {
    const granted = await grantConsent(
      admin,
      { customer: { id: customer.id, name: customer.name, email: customer.email, phone: customer.phone, emailConfirmed: customer.emailConfirmed }, profileId: profile.id, channel: "email", source: "connect_form" },
      ensureCommunityMember
    );
    consentRecorded = granted.ok;
    if (!granted.ok) console.error("consent not recorded at connect:", granted.code);
  }

  // Community membership: every connected customer is on the creator's community list.
  // Email updates are ON only for an explicit tick on a confirmed email (an unconfirmed
  // tick stays on the connection and is applied by syncMarketingSubscribers later).
  const emailUpdates = consentRecorded && customer.emailConfirmed;
  if (!existingSubscriberId) {
    await ensureCommunityMember(admin, { connectionId, customer, profileId: profile.id, emailUpdates });
  } else if (emailUpdates) {
    await admin
      .from("community_subscription_preferences")
      .update({ email_updates: true, updated_at: now })
      .eq("subscriber_id", existingSubscriberId);
  }

  return { ok: true, consentRecorded };
}

export async function ensureCommunityMember(
  admin: any,
  input: {
    connectionId: string;
    customer: { name: string; email: string; phone: string | null };
    profileId: string;
    emailUpdates: boolean;
  }
) {
  // Matched with LIKE wildcards escaped so `_`/`%` in an address can't match a
  // DIFFERENT person's row.
  const { data: existing } = await admin
    .from("community_subscribers")
    .select("id, status")
    .eq("profile_id", input.profileId)
    .ilike("email", escapeLike(input.customer.email))
    .maybeSingle();

  const link = (subscriberId: string) =>
    admin
      .from("customer_connections")
      .update({ community_subscriber_id: subscriberId, updated_at: new Date().toISOString() })
      .eq("id", input.connectionId);

  if (existing) {
    // Someone who unsubscribed or was removed stays that way. An active row not yet
    // tied to another connection (e.g. this customer's own row from before a
    // disconnect/reconnect) is re-linked so community push reaches them again.
    if (existing.status !== "active") return;
    const { data: taken } = await admin
      .from("customer_connections")
      .select("id")
      .eq("community_subscriber_id", existing.id)
      .neq("id", input.connectionId)
      .limit(1);
    if (!taken || taken.length === 0) await link(existing.id);
    if (input.emailUpdates) {
      await admin
        .from("community_subscription_preferences")
        .update({ email_updates: true, updated_at: new Date().toISOString() })
        .eq("subscriber_id", existing.id);
    }
    return;
  }

  const { data: created, error } = await admin
    .from("community_subscribers")
    .insert({
      profile_id: input.profileId,
      name: input.customer.name,
      email: input.customer.email,
      phone: input.customer.phone,
      source: "ringo_profile",
    })
    .select("id")
    .single();
  // 23505 = a row appeared in parallel (unique profile+email index): leave it alone.
  if (error || !created) {
    if (error?.code !== "23505") console.error("community_subscribers insert failed:", error?.message);
    return;
  }

  await admin.from("community_subscription_preferences").insert({
    subscriber_id: created.id,
    email_updates: input.emailUpdates,
    whatsapp_updates: false,
    push_updates: true,
  });
  await link(created.id);
}

export type CreateCustomerResult =
  | { status: "created"; customer: { id: string; name: string } }
  | { status: "exists" }
  | { status: "migration_pending" }
  | { status: "error" };

/**
 * Creates a brand-new customer straight from the Stay Connected form — no emailed
 * code. email_verified_at stays NULL: the address is what they typed, not proof.
 *
 * If the email already belongs to ANY customer (confirmed or not) this returns
 * "exists" and creates nothing: the form alone must never sign anyone into an
 * existing account, or knowing someone's email would be enough to open their My
 * Ringo. The caller then falls back to the emailed-code sign-in for that email.
 */
export async function createUnconfirmedCustomer(
  admin: any,
  input: { email: string; name: string; phone: string; language: "en" | "fr" }
): Promise<CreateCustomerResult> {
  const { data: existing } = await admin.from("ringo_customers").select("id").eq("email", input.email).maybeSingle();
  if (existing) return { status: "exists" };

  const { data: created, error } = await admin
    .from("ringo_customers")
    .insert({
      email: input.email,
      name: input.name,
      phone: input.phone,
      preferred_language: input.language,
      email_verified_at: null,
      last_login_at: new Date().toISOString(),
    })
    .select("id, name")
    .single();

  if (created) return { status: "created", customer: created };
  // Lost a race with a parallel registration of the same email.
  if (error?.code === "23505") return { status: "exists" };
  // 23502 = not-null violation: 2026-10-20_customer_email_optional_verification.sql
  // has not been applied yet.
  if (error?.code === "23502") {
    console.error("ringo_customers.email_verified_at is still NOT NULL — apply 2026-10-20_customer_email_optional_verification.sql");
    return { status: "migration_pending" };
  }
  console.error("ringo_customers insert failed:", error?.message);
  return { status: "error" };
}

/**
 * Called when a customer confirms their email. Applies the email opt-ins that are VALID BUT NOT YET APPLIED (see decideConsent in ./consent): a consent that was recorded against an unconfirmed
 * address. It never switches anything back on for a person who has since unsubscribed, withdrawn consent, been removed, or switched email off; one rule decides both this and the Community
 * unsubscribe.
 */
export async function syncMarketingSubscribers(
  admin: any,
  customer: { id: string; name: string; email: string; phone: string | null }
): Promise<void> {
  await applyPendingEmail(admin, customer, ensureCommunityMember);
}
