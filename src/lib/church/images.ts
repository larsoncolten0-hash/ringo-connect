// The pictures a church can put on an event, an announcement or a care case. Pure: no I/O, no React.
//
// Only a picture uploaded to THIS platform's own public storage is accepted (the editor's upload button puts it there): https, the storage host of this project when it is configured, the public
// "uploads" bucket, a plain file path, no query string, no fragment, no credentials, no spaces. The database checks the generic SHAPE of an address (https, a real host, at most 500 characters);
// this is the stricter rule, applied when the church saves AND again before a page shows anything, so an address written some other way can never reach a visitor.

const PUBLIC_PREFIX = "/storage/v1/object/public/uploads/";
const PATH_CHARS = /^[A-Za-z0-9._~%/-]+$/;

export function safeChurchImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (s.length < 12 || s.length > 500 || /[\s\u0000-\u001f\u007f]/.test(s)) return null;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash || u.port) return null;
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (configured) {
    try {
      if (u.host !== new URL(configured).host) return null;
    } catch {
      /* an unusable configured address does not make an address acceptable or unacceptable by itself */
    }
  }
  if (!u.pathname.startsWith(PUBLIC_PREFIX) || u.pathname.length <= PUBLIC_PREFIX.length) return null;
  const file = u.pathname.slice(PUBLIC_PREFIX.length);
  if (!PATH_CHARS.test(file) || file.split("/").some((seg) => seg === ".." || seg === "." || seg === "") || file.endsWith("/")) return null;
  return s;
}

/** The picture of a database row, only when it is a valid address in this platform's own storage; otherwise nothing (the key is absent, so a row without a picture looks exactly as before). */
export const pictureOf = (r: Record<string, unknown>): { image_url?: string } => {
  const u = safeChurchImageUrl(r.image_url);
  return u ? { image_url: u } : {};
};
