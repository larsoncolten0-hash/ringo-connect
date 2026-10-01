// The PUBLIC side of a share link: no Ringo account, no session. The token is the only credential.
//
// Every failure — malformed, unknown, revoked, expired, rate-limited-then-unknown, unreadable — is reported to the caller as the
// same "unavailable" outcome (the route answers one uniform 404 page/body), so a response never reveals whether a token ever existed.
// Rate limiting is the one exception that is distinguishable (HTTP 429): it carries no information about any token.
// The resolver returns the document only through its own business id, so nothing unrelated to the link can be reached.
import { modelFromRows } from "./snapshot";
import { toLocalDateKey } from "@/lib/bookkeeping/summary";
import { DOCUMENT_TIME_ZONE } from "./constants";
import { renderStoredPdf, loadDocumentFrom, type ApiResult } from "./handlers";
import { hashClientIp, hashShareToken, isWellFormedShareToken } from "./shareToken";
import type { DocumentModel } from "./types";

export const SHARE_RATE_WINDOW_SECONDS = 600;
export const SHARE_RATE_MAX = 60;

export type ShareOutcome =
  | { kind: "ok"; model: DocumentModel; docId: string; profileId: string; filename: string }
  | { kind: "unavailable" }
  | { kind: "limited" };

/** Spends one request from this caller's budget. Fails CLOSED: if the limiter cannot answer, the request is refused. */
async function allowed(admin: any, ip: string): Promise<boolean> {
  try {
    const r = await admin.rpc("bk_doc_rate_limit_hit", { p_kind: "share_ip", p_subject_hash: hashClientIp(ip), p_window_seconds: SHARE_RATE_WINDOW_SECONDS, p_max: SHARE_RATE_MAX });
    return !r.error && r.data === true;
  } catch {
    return false;
  }
}

async function resolve(admin: any, token: string): Promise<{ documentId: string; profileId: string; status: string } | null> {
  if (!isWellFormedShareToken(token)) return null;
  try {
    const r = await admin.rpc("doc_resolve_share", { p_token_hash: hashShareToken(token) });
    if (r.error || !r.data || typeof r.data !== "object") return null;
    const d = r.data as any;
    if (typeof d.document_id !== "string" || typeof d.profile_id !== "string") return null;
    return { documentId: d.document_id, profileId: d.profile_id, status: String(d.status) };
  } catch {
    return null;
  }
}

export async function openShare(admin: any, token: string, ip: string): Promise<ShareOutcome> {
  if (!(await allowed(admin, ip))) return { kind: "limited" };
  const hit = await resolve(admin, token);
  if (!hit) return { kind: "unavailable" };
  const loaded = await loadDocumentFrom(admin, hit.profileId, hit.documentId);
  if ("error" in loaded) return { kind: "unavailable" };
  const { doc, lines } = loaded;
  if (doc.status === "draft") return { kind: "unavailable" };
  let parent: { doc: any; lines: any[] } | null = null;
  if (doc.doc_type === "receipt" && doc.parent_document_id) {
    const p = await loadDocumentFrom(admin, hit.profileId, doc.parent_document_id);
    if ("error" in p) return { kind: "unavailable" };
    parent = { doc: p.doc, lines: p.lines };
  }
  try {
    const model = modelFromRows({ doc, lines, parent, todayKey: toLocalDateKey(new Date(), DOCUMENT_TIME_ZONE) });
    return { kind: "ok", model, docId: doc.id, profileId: hit.profileId, filename: String(doc.number || "document") };
  } catch {
    return { kind: "unavailable" };
  }
}

/** The PDF behind a share link: identical bytes to the owner's download. */
export async function openSharedPdf(admin: any, token: string, ip: string): Promise<{ kind: "limited" } | { kind: "unavailable" } | { kind: "ok"; result: Extract<ApiResult, { pdf: Uint8Array }> }> {
  if (!(await allowed(admin, ip))) return { kind: "limited" };
  const hit = await resolve(admin, token);
  if (!hit || hit.status === "draft") return { kind: "unavailable" };
  const out = await renderStoredPdf(admin, admin, hit.profileId, hit.documentId);
  if (!("pdf" in out)) return { kind: "unavailable" };
  return { kind: "ok", result: out };
}

/** First address of x-forwarded-for (set by the platform edge), else a fixed bucket. Only ever hashed. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  const first = xff ? xff.split(",")[0].trim() : "";
  return first || headers.get("x-real-ip") || "unknown";
}
