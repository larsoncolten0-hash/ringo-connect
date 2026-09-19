// Connect logic shared by /api/customer/connect (already signed in),
// /api/customer/connect/register (brand-new customer, no email code) and
// /api/customer/connect/verify (existing customer proving the email with a code).
//
// RULES (approved Phase 2 decisions — see the Connect design thread):
//  * Connect alone writes ONLY ringo_customers / customer_sessions /
//    customer_connections. It never touches community_subscribers.
//  * Only an explicit marketing tick may create a community_subscribers
//    row, and only when NONE already exists for that profile + email.
//    A pre-existing legacy row is left completely untouched: not
//    reactivated, not edited, not linked, not treated as consent.
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
): Promise<{ ok: boolean }> {
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
        marketing_consent: input.marketingConsent,
        marketing_consent_at: input.marketingConsent ? now : null,
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
      // only from the explicit tick made in THIS request.
      await admin
        .from("customer_connections")
        .update({
          status: "active",
          disconnected_at: null,
          marketing_consent: input.marketingConsent,
          marketing_consent_at: input.marketingConsent ? now : null,
          community_subscriber_id: null,
          updated_at: now,
        })
        .eq("id", connectionId);
      existingSubscriberId = null;
    } else if (input.marketingConsent && existing.marketing_consent !== true) {
      // Only THIS request's explicit tick can turn consent on; an existing
      // opt-in is left as-is and a missing tick never changes anything.
      await admin
        .from("customer_connections")
        .update({ marketing_consent: true, marketing_consent_at: now, updated_at: now })
        .eq("id", connectionId);
    }
  }

  // Legacy community step — ONLY on an explicit tick, and only once the email is
  // confirmed (otherwise the tick stays on the connection and is applied by
  // syncMarketingSubscribers when the customer confirms). Community is always on
  // for every profile, but that never subscribes anyone by itself.
  if (input.marketingConsent && !existingSubscriberId && customer.emailConfirmed) {
    await createCommunitySubscriberIfNoneExists(admin, { connectionId, customer, profileId: profile.id });
  }

  return { ok: true };
}

async function createCommunitySubscriberIfNoneExists(
  admin: any,
  input: { connectionId: string; customer: { name: string; email: string; phone: string | null }; profileId: string }
) {
  // Any existing legacy row (any status) => hands off entirely. Matched
  // with LIKE wildcards escaped so `_`/`%` in an address can't match a
  // DIFFERENT person's row.
  const { data: legacy } = await admin
    .from("community_subscribers")
    .select("id")
    .eq("profile_id", input.profileId)
    .ilike("email", escapeLike(input.customer.email))
    .maybeSingle();
  if (legacy) return;

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
  // 23505 = a legacy row appeared in parallel (unique profile+email index):
  // same outcome as "already exists" — leave it alone.
  if (error || !created) {
    if (error?.code !== "23505") console.error("community_subscribers insert failed:", error?.message);
    return;
  }

  await admin.from("community_subscription_preferences").insert({
    subscriber_id: created.id,
    email_updates: true,
    whatsapp_updates: false,
  });
  await admin
    .from("customer_connections")
    .update({ community_subscriber_id: created.id, updated_at: new Date().toISOString() })
    .eq("id", input.connectionId);
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
 * Called when a customer confirms their email. Any connection where they ticked
 * marketing but no community_subscribers row could be created yet (unconfirmed
 * email) now gets one — still only where NO legacy row already exists for that
 * profile + email, exactly as at connect time.
 */
export async function syncMarketingSubscribers(
  admin: any,
  customer: { id: string; name: string; email: string; phone: string | null }
): Promise<void> {
  const { data: connections } = await admin
    .from("customer_connections")
    .select("id, profile_id")
    .eq("customer_id", customer.id)
    .eq("status", "active")
    .eq("marketing_consent", true)
    .is("community_subscriber_id", null);

  for (const c of connections || []) {
    await createCommunitySubscriberIfNoneExists(admin, { connectionId: c.id, customer, profileId: c.profile_id });
  }
}
