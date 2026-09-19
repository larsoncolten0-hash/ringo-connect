import { createAdminClient } from "@/lib/supabase/server";
import { resolveCustomerIdByQr } from "@/lib/loyalty/qr";
import { MAX_SEARCH_RESULTS, maskEmail, maskPhone, sanitizeSearchTerm } from "@/lib/loyalty/privacy";
import { isUuid } from "@/lib/loyalty/validate";
import type { LoyaltyAdmin } from "@/lib/loyalty/engine";

// How a business reaches a customer. There are exactly two ways, and BOTH require an
// ACTIVE connection between that customer and THIS profile:
//   1. scanning the customer's QR            -> resolveScan
//   2. searching among already-connected customers -> searchConnectedCustomers
//
// Neither ever returns a raw customer id to the browser. The browser only ever holds a
// `connection_id` (customer_connections.id), and every later action re-resolves it with
// getActiveConnection(profileId, connectionId), which fails unless that connection
// belongs to the caller's profile and is still active. There is no global customer
// directory and no way to look up a customer who has not connected to the business.

export interface ConnectedCustomer {
  connectionId: string;
  customerId: string; // SERVER-SIDE ONLY: pass to the engine, never serialise to a response
  name: string;
  connectedAt: string;
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** The active connection between `profileId` and the customer behind `connectionId`, or null. */
export async function getActiveConnection(
  profileId: string,
  connectionId: unknown,
  admin: LoyaltyAdmin = createAdminClient()
): Promise<ConnectedCustomer | null> {
  if (!isUuid(profileId) || !isUuid(connectionId)) return null;
  const { data } = await admin
    .from("customer_connections")
    .select("id, customer_id, connected_at, ringo_customers(name)")
    .eq("id", connectionId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) return null;
  const row = data as any;
  const customer = one<any>(row.ringo_customers);
  return {
    connectionId: row.id,
    customerId: row.customer_id,
    name: customer?.name ?? "",
    connectedAt: row.connected_at,
  };
}

export type ScanResolution =
  | { status: "invalid_qr" }
  | { status: "not_connected" }
  | { status: "ok"; customer: ConnectedCustomer };

/**
 * QR text -> customer, for one specific business profile.
 *   invalid_qr    malformed, unknown OR revoked code (deliberately indistinguishable)
 *   not_connected a real code, but the customer has no active connection to this
 *                 profile; NO customer data is returned in this case
 *   ok            the connected customer
 * The profile id must come from the authenticated business session (access.ts).
 */
export async function resolveScan(
  profileId: string,
  qrText: unknown,
  admin: LoyaltyAdmin = createAdminClient()
): Promise<ScanResolution> {
  const customerId = await resolveCustomerIdByQr(qrText, admin);
  if (!customerId) return { status: "invalid_qr" };

  const { data } = await admin
    .from("customer_connections")
    .select("id, customer_id, connected_at, ringo_customers(name)")
    .eq("customer_id", customerId)
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) return { status: "not_connected" };

  const row = data as any;
  const customer = one<any>(row.ringo_customers);
  return {
    status: "ok",
    customer: { connectionId: row.id, customerId: row.customer_id, name: customer?.name ?? "", connectedAt: row.connected_at },
  };
}

export interface CustomerSearchHit {
  connectionId: string;
  name: string;
  emailHint: string | null;
  phoneHint: string | null;
}

/**
 * Search the business's OWN active connections by name, email or phone. A search term
 * under 3 characters returns nothing, results are capped, and email/phone come back
 * masked, so this cannot be used to enumerate or harvest customers.
 */
export async function searchConnectedCustomers(
  profileId: string,
  rawTerm: unknown,
  admin: LoyaltyAdmin = createAdminClient()
): Promise<{ tooShort: boolean; hits: CustomerSearchHit[] }> {
  const term = sanitizeSearchTerm(rawTerm);
  if (!term) return { tooShort: true, hits: [] };

  const { data, error } = await admin
    .from("customer_connections")
    .select("id, ringo_customers!inner(name, email, phone)")
    .eq("profile_id", profileId)
    .eq("status", "active")
    .or(`name.ilike.*${term}*,email.ilike.*${term}*,phone.ilike.*${term}*`, { referencedTable: "ringo_customers" })
    .order("connected_at", { ascending: false })
    .limit(MAX_SEARCH_RESULTS);
  if (error) {
    console.error("loyalty customer search failed:", error.message);
    return { tooShort: false, hits: [] };
  }

  const hits = ((data ?? []) as any[]).flatMap((row) => {
    const c = one<any>(row.ringo_customers);
    if (!c) return [];
    return [{ connectionId: row.id as string, name: c.name as string, emailHint: maskEmail(c.email), phoneHint: maskPhone(c.phone) }];
  });
  return { tooShort: false, hits };
}
