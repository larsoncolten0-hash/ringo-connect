import { createAdminClient } from "@/lib/supabase/server";
import {
  buildQrPayload,
  deriveQrSecret,
  getQrKey,
  hashQrSecret,
  newQrNonce,
  parseQrPayload,
} from "@/lib/loyalty/qrCrypto";
import type { LoyaltyAdmin } from "@/lib/loyalty/engine";

// Database side of the customer QR (see qrCrypto.ts for the format and why the secret
// is never stored). Both functions are server-only.

/**
 * The QR text for the SIGNED-IN customer (`customerId` must come from the customer
 * session, never from a request). Creates their code on first use; `rotate: true`
 * revokes the current code and issues a new one.
 *
 * Rotating changes ONLY the QR: the customer identity, connections, rewards, packages
 * and history are untouched (the database function only revokes/inserts QR rows).
 *
 * Self-healing: if LOYALTY_QR_SECRET was rotated since the code was issued, the stored
 * hash no longer matches what the server would render, so a fresh code is issued
 * instead of showing a QR that would never scan.
 */
export async function getCustomerQrPayload(
  customerId: string,
  options: { rotate?: boolean } = {},
  admin: LoyaltyAdmin = createAdminClient()
): Promise<string> {
  const key = getQrKey();

  const issue = async (rotate: boolean): Promise<string> => {
    const nonce = newQrNonce();
    const secretHash = hashQrSecret(deriveQrSecret(key, customerId, nonce));
    const { data, error } = await admin.rpc("loyalty_issue_qr" as any, {
      p_customer_id: customerId,
      p_nonce: nonce,
      p_secret_hash: secretHash,
      p_rotate: rotate,
    } as any);
    if (error) throw new Error(`loyalty_issue_qr failed: ${error.message}`);
    return data as string;
  };

  let liveNonce = await issue(options.rotate === true);
  let secret = deriveQrSecret(key, customerId, liveNonce);

  const { data: row } = await admin
    .from("customer_qr_codes")
    .select("secret_hash")
    .eq("customer_id", customerId)
    .is("revoked_at", null)
    .maybeSingle();
  if (!row || (row as any).secret_hash !== hashQrSecret(secret)) {
    liveNonce = await issue(true);
    secret = deriveQrSecret(key, customerId, liveNonce);
  }

  return buildQrPayload(secret);
}

/**
 * Scanned text -> customer id, or null. Malformed, unknown and revoked codes all return
 * null, so the caller can show ONE generic "invalid QR" message and reveal nothing about
 * which of those it was. This only identifies a customer; it is never an authorization
 * on its own (see customers.ts resolveScan, which also requires an active connection).
 */
export async function resolveCustomerIdByQr(
  text: unknown,
  admin: LoyaltyAdmin = createAdminClient()
): Promise<string | null> {
  const secret = parseQrPayload(text);
  if (!secret) return null;

  const { data } = await admin
    .from("customer_qr_codes")
    .select("customer_id")
    .eq("secret_hash", hashQrSecret(secret))
    .is("revoked_at", null)
    .maybeSingle();
  return (data as any)?.customer_id ?? null;
}
