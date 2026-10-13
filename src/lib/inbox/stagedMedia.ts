import { MEDIA_TYPES, STAGED_VIDEO_MAX_BYTES, checkAttachmentMeta, extensionOf, mimeFromExtension, normalizeMime, sanitizeFilename } from "@/lib/whatsapp/mediaRules";
import { isUuid } from "./format";

// Large VIDEOS (over what the upload route can receive, about 4 MB, up to Meta's 16 MB) are STAGED: the browser uploads the file straight to a private storage bucket with a
// one-time signed upload URL, then asks the send route to send it. The send route reads the file back with the service role, validates its bytes exactly like any other
// outbound file, uploads it to Meta, and deletes the staged copy.
//   * the bucket is private (no public url, no policies): only a signed upload url made here can write to it, only the server can read it
//   * the object name is chosen HERE from the session's profile, the conversation and the send's own request id, never by the browser. One staged object belongs to exactly ONE
//     send: it can only ever be sent under the request id it was named for, so it can neither be sent twice under different ids nor be taken over by another send
//   * what the browser DECLARES (name, type, size) is only checked to refuse early; before the server downloads anything it asks storage itself (statStaged) for the object's real
//     size and content type, and refuses an oversized, mistyped or unverifiable object without loading its bytes. Nothing the browser says is trusted at send time:
//     the type and extension come from the object's server-chosen name, the size from storage, the codec from the bytes (see mp4Inspect.ts)
// Nothing here knows the recipient, the phone number or the token.

export const STAGING_BUCKET = "inbox-outbound-media";
const STAGED_KINDS = new Set(["video"]);
const MIME_OF_EXT: Record<string, string> = { mp4: "video/mp4", "3gp": "video/3gpp" };

export type StageProblem = "empty_file" | "too_large" | "unsupported_type" | "type_mismatch" | "bad_filename" | "not_stageable";

/** The browser's declared file, checked before any url is issued. Only videos are staged; everything else uses the direct route. */
export function checkStageRequest(input: { name: unknown; type: unknown; size: unknown }): { ok: true; mime: string; ext: string; name: string; size: number } | { ok: false; error: StageProblem } {
  const size = typeof input.size === "number" && Number.isFinite(input.size) ? Math.floor(input.size) : 0;
  const rawName = typeof input.name === "string" ? input.name : "";
  const rawType = typeof input.type === "string" ? input.type : "";
  const check = checkAttachmentMeta({ name: rawName, type: rawType, size });
  if (check !== "ok") return { ok: false, error: check };
  const safe = sanitizeFilename(rawName) as string;
  let mime = normalizeMime(rawType);
  if (!MEDIA_TYPES[mime]) mime = mimeFromExtension(extensionOf(safe)) ?? mime;
  const rule = MEDIA_TYPES[mime];
  if (!rule || !STAGED_KINDS.has(rule.kind)) return { ok: false, error: "not_stageable" };
  if (size > STAGED_VIDEO_MAX_BYTES) return { ok: false, error: "too_large" };
  return { ok: true, mime, ext: rule.ext, name: safe, size };
}

/** profile/conversation/request-id.ext : the only shape the server will ever read back. The object id IS the send's request id. */
export const stagedPath = (profileId: string, conversationId: string, requestId: string, ext: string): string => `${profileId}/${conversationId}/${requestId}.${ext}`;

export interface ParsedStagedPath {
  requestId: string;
  ext: "mp4" | "3gp";
  /** the one type the server accepts for this object, derived from its (server-chosen) extension, never from anything the browser said */
  mime: string;
}

/** The parts of a staged path, or null unless it is exactly `<this profile>/<this conversation>/<uuid>.<mp4|3gp>`. */
export function parseStagedPath(path: unknown, profileId: string | null, conversationId: string): ParsedStagedPath | null {
  if (typeof path !== "string" || !profileId || !isUuid(profileId) || !isUuid(conversationId)) return null;
  const m = /^([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\.(mp4|3gp)$/i.exec(path);
  if (!m || m[1].toLowerCase() !== profileId.toLowerCase() || m[2].toLowerCase() !== conversationId.toLowerCase() || !isUuid(m[3])) return null;
  const ext = m[4].toLowerCase() as "mp4" | "3gp";
  return { requestId: m[3].toLowerCase(), ext, mime: MIME_OF_EXT[ext] };
}

/** True only for this profile's staged video of this conversation; when a request id is given, the object must have been staged FOR that request. */
export function isStagedPathFor(path: unknown, profileId: string | null, conversationId: string, requestId?: unknown): path is string {
  const parsed = parseStagedPath(path, profileId, conversationId);
  if (!parsed) return false;
  if (requestId === undefined) return true;
  return typeof requestId === "string" && isUuid(requestId) && requestId.toLowerCase() === parsed.requestId;
}

type StorageClient = { storage: { from(bucket: string): any } };

/**
 * The conversation really belongs to this profile, read through the signed-in person's OWN session (row level security applies on top). The guard alone is not enough here: for a
 * person who is an owner but not THIS conversation's owner it still answers "ok" (the database normally says 404 later), and staging never reaches the database until the send.
 */
export async function conversationBelongsTo(session: { from(table: string): any }, profileId: string | null, conversationId: string): Promise<boolean> {
  if (!profileId || !isUuid(profileId) || !isUuid(conversationId)) return false;
  try {
    const res = await session.from("inbox_conversations").select("id").eq("id", conversationId).eq("profile_id", profileId).maybeSingle();
    return !res.error && !!res.data;
  } catch {
    return false;
  }
}

export type StageIssued = { ok: true; path: string; signedUrl: string } | { ok: false; error: "unavailable" };

export async function issueStagedUpload(storage: StorageClient, args: { profileId: string; conversationId: string; requestId: string; ext: string }): Promise<StageIssued> {
  const path = stagedPath(args.profileId, args.conversationId, args.requestId, args.ext);
  try {
    const res = await storage.storage.from(STAGING_BUCKET).createSignedUploadUrl(path);
    if (res.error || !res.data?.signedUrl) return { ok: false, error: "unavailable" };
    return { ok: true, path, signedUrl: String(res.data.signedUrl) };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

const isNotFound = (e: any): boolean => {
  const status = String(e?.status ?? e?.statusCode ?? "");
  return status === "404" || /not.?found|no such/i.test(String(e?.message ?? ""));
};

export type StagedStat = { ok: true; size: number; contentType: string } | { ok: false; error: "missing" | "too_large" | "bad_type" | "unverifiable" };

type RawMeta = { found: true; size: unknown; contentType: unknown } | { found: false } | { error: true };

/** The object's metadata from storage's single-object endpoint (info). null = this storage client or server has no such call. */
async function viaInfo(bucket: any, path: string): Promise<RawMeta | null> {
  if (typeof bucket.info !== "function") return null;
  try {
    const r = await bucket.info(path);
    if (r.error) return isNotFound(r.error) ? { found: false } : { error: true };
    return { found: true, size: r.data?.size ?? r.data?.metadata?.size, contentType: r.data?.contentType ?? r.data?.metadata?.mimetype };
  } catch {
    return { error: true };
  }
}

/** The object's metadata from storage's listing of its folder (older storage versions): the same authoritative record, found by exact name. null = no such call. */
async function viaList(bucket: any, path: string): Promise<RawMeta | null> {
  if (typeof bucket.list !== "function") return null;
  try {
    const slash = path.lastIndexOf("/");
    const name = path.slice(slash + 1);
    const r = await bucket.list(path.slice(0, slash), { limit: 5, search: name });
    if (r.error) return { error: true };
    const hit = (r.data ?? []).find((o: any) => o?.name === name);
    return hit ? { found: true, size: hit.metadata?.size, contentType: hit.metadata?.mimetype } : { found: false };
  } catch {
    return { error: true };
  }
}

/**
 * What STORAGE itself says about a staged object (size and content type, recorded by the storage service, not by our browser code), obtained WITHOUT downloading the file.
 * "Missing" is only concluded when storage really says the object is not there (confirmed through the listing when the single-object call answered 404, since an older storage
 * server answers that call with a 404 as well). Fails closed: if the metadata cannot be read, or is incomplete or implausible, the answer is "unverifiable" and the caller must
 * not download anything.
 */
export async function statStaged(storage: StorageClient, path: string, expectedMime: string): Promise<StagedStat> {
  let meta: RawMeta;
  try {
    const bucket = storage.storage.from(STAGING_BUCKET);
    const first = await viaInfo(bucket, path);
    if (first && "found" in first && first.found) meta = first;
    else {
      const second = await viaList(bucket, path);
      if (second && "found" in second && second.found) meta = second;
      else if (first && "found" in first && !first.found && (second === null || ("found" in second && !second.found))) meta = { found: false };
      else if (!first && second && "found" in second && !second.found) meta = { found: false };
      else return { ok: false, error: "unverifiable" };
    }
  } catch {
    return { ok: false, error: "unverifiable" };
  }
  if (!("found" in meta) || !meta.found) return { ok: false, error: "missing" };
  const { size, contentType } = meta;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return { ok: false, error: "unverifiable" };
  if (size > STAGED_VIDEO_MAX_BYTES) return { ok: false, error: "too_large" };
  const type = normalizeMime(contentType);
  if (!type) return { ok: false, error: "unverifiable" };
  if (type !== expectedMime) return { ok: false, error: "bad_type" };
  return { ok: true, size, contentType: type };
}

export type StagedRead = { ok: true; bytes: Uint8Array } | { ok: false; error: "missing" | "too_large" | "unavailable" };

/**
 * Reads a staged file. `expectedSize` is the size storage reported (statStaged): an object whose downloaded size differs from it was changed in between and is refused, and nothing
 * over the video ceiling is ever turned into bytes.
 */
export async function readStaged(storage: StorageClient, path: string, expectedSize: number): Promise<StagedRead> {
  try {
    const res = await storage.storage.from(STAGING_BUCKET).download(path);
    if (res.error || !res.data) {
      const status = Number((res.error as any)?.status ?? (res.error as any)?.statusCode);
      return { ok: false, error: status === 404 || /not.?found/i.test(String((res.error as any)?.message ?? "")) ? "missing" : "unavailable" };
    }
    const blob = res.data as Blob;
    if (blob.size > STAGED_VIDEO_MAX_BYTES) return { ok: false, error: "too_large" };
    if (blob.size !== expectedSize) return { ok: false, error: "unavailable" };
    return { ok: true, bytes: new Uint8Array(await blob.arrayBuffer()) };
  } catch {
    return { ok: false, error: "unavailable" };
  }
}

/**
 * Best effort: a staged copy that cannot be removed now is harmless (private, capped), and is logged by category only. Callers pass ONLY a path that parseStagedPath accepted for the
 * signed-in person's own profile and this conversation, so this can never delete another person's file.
 */
export async function removeStaged(storage: StorageClient, path: string): Promise<void> {
  try {
    await storage.storage.from(STAGING_BUCKET).remove([path]);
  } catch {
    console.error(JSON.stringify({ scope: "whatsapp_media", result: "staged_cleanup_failed" }));
  }
}
