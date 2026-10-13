// (Kept outside src/lib/supabase/, which is a protected area, and outside the Inbox/WhatsApp folders: it is not part of either.)
// The Supabase PUBLIC (anon) key, which is meant to be sent to browsers: it grants nothing by itself (row level security and signed urls decide what any request can do).
// The only use of this module is to hand a browser the two headers Supabase's gateway expects on a SIGNED upload url a server just issued. The service role key is never here.

export function signedUploadHeaders(): Record<string, string> {
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "").trim();
  return key ? { apikey: key, authorization: `Bearer ${key}`, "x-upsert": "false" } : { "x-upsert": "false" };
}
