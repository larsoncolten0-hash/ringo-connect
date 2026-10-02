// Fetches the business logo for a template-v2 PDF. The logo URL is the one frozen in the document's seller snapshot (profiles.avatar_url at issue). It is only
// ever fetched when it is an https URL on the project's OWN storage host (never an arbitrary address), with a short timeout, a size cap and a magic-byte check
// (PNG or JPEG: the only formats pdf-lib embeds). Anything else, or any failure, simply means "no logo": a document is never refused over its logo.
export type LogoBytes = { bytes: Uint8Array; kind: "png" | "jpg" };

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 3000;

export function allowedLogoHost(env: Record<string, string | undefined> = process.env): string | null {
  try {
    return env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).host : null;
  } catch {
    return null;
  }
}

export function sniffImage(bytes: Uint8Array): "png" | "jpg" | null {
  if (bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
  if (bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpg";
  return null;
}

export async function fetchLogoBytes(url: string | null, opts: { host?: string | null; fetchImpl?: typeof fetch } = {}): Promise<LogoBytes | null> {
  try {
    if (!url) return null;
    const u = new URL(url);
    const host = opts.host === undefined ? allowedLogoHost() : opts.host;
    if (u.protocol !== "https:" || !host || u.host !== host) return null;
    const res = await (opts.fetchImpl ?? fetch)(u.toString(), { redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const declared = Number(res.headers.get("content-length") || 0);
    if (declared > MAX_BYTES) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_BYTES) return null;
    const kind = sniffImage(buf);
    return kind ? { bytes: buf, kind } : null;
  } catch {
    return null;
  }
}
