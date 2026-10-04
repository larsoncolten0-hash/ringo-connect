import type { InboundMessageEvent, StatusEvent, WhatsAppEvent } from "./types";

// Hands one normalized, already-verified Phase 3 event to the Phase 4 database functions
// (supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql). Nothing else happens here: no raw payload,
// no profile id (the database derives the owner from wa_accounts via phone_number_id), no network call besides the RPC.
//
// The database functions return a result string for every NORMAL outcome (including bad/unknown input) and raise only on a
// genuine database fault. This module mirrors that contract: a returned category is a result, anything else is an IngestFailure
// that the webhook turns into HTTP 5xx so Meta retries (the unique indexes make a retry safe).

export type IngestOutcome = "created" | "duplicate" | "unknown_account" | "account_disabled" | "waba_mismatch" | "invalid";
const OUTCOMES: readonly string[] = ["created", "duplicate", "unknown_account", "account_disabled", "waba_mismatch", "invalid"];

/** The one method of the Supabase client this module needs (keeps the dependency narrow and easy to fake in tests). */
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { code?: string } | null }>;
}

/** A genuine failure (database/RPC error or an unrecognised answer). Carries a short code only: never row data or text. */
export class IngestFailure extends Error {
  constructor(public readonly code: string) {
    super(`whatsapp_ingest_failed:${code}`);
    this.name = "IngestFailure";
  }
}

export function messageRpcArgs(e: InboundMessageEvent): Record<string, unknown> {
  return {
    p_phone_number_id: e.phoneNumberId,
    p_waba_id: e.wabaId,
    p_message_id: e.messageId,
    p_from: e.from,
    p_timestamp: e.timestamp,
    p_type: e.type,
    p_text: e.text,
    p_contact_name: e.contactName,
    p_reply_to_message_id: e.replyToMessageId,
    p_media_kind: e.media?.kind ?? null,
    p_media_id: e.media?.mediaId ?? null,
    p_media_mime_type: e.media?.mimeType ?? null,
    p_media_sha256: e.media?.sha256 ?? null,
    p_media_filename: e.media?.filename ?? null,
    p_media_caption: e.media?.caption ?? null,
  };
}

export function statusRpcArgs(e: StatusEvent): Record<string, unknown> {
  return {
    p_phone_number_id: e.phoneNumberId,
    p_waba_id: e.wabaId,
    p_message_id: e.messageId,
    p_status: e.status,
    p_timestamp: e.timestamp,
    p_error_codes: e.errorCodes,
  };
}

export async function ingestEvent(client: RpcClient, e: WhatsAppEvent): Promise<IngestOutcome> {
  const [fn, args] =
    e.kind === "message"
      ? (["inbox_ingest_whatsapp_message", messageRpcArgs(e)] as const)
      : (["inbox_ingest_whatsapp_status", statusRpcArgs(e)] as const);

  let res: { data: unknown; error: { code?: string } | null };
  try {
    res = await client.rpc(fn, args);
  } catch {
    throw new IngestFailure("rpc_exception");
  }
  if (res.error) throw new IngestFailure(String(res.error.code || "rpc_error").slice(0, 20));
  if (typeof res.data !== "string" || !OUTCOMES.includes(res.data)) throw new IngestFailure("unexpected_result");
  return res.data as IngestOutcome;
}
