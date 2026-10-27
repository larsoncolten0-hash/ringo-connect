import { has, isUuid, optionalText, plainObject, type Checked } from "../validation";
import { normalizeTestimonyPhone } from "../testimonies/submit";

// Churches & Ministries expansion, Phase 6: what a VISITOR sends when they ask to meet a pastor or counsellor. Pure validation plus the one server-side submission step. No React.
//
//   * A visitor needs no account. The route that calls this is public by design, so everything is re-derived here: the church comes from the public page's own username and must be a PUBLISHED church page
//     whose owner switched counselling on (never an id from the client), every field is validated and cleaned, and the answer is the same plain "ok" for a new, a repeated and a spam request.
//   * The service-role client is handed in by the route (this file never creates one). It is the only way in: no API role can insert into the table, and none can read it without a counselling permission.
//   * Nothing from the request is logged, ever: not the reason, not a name, not a number. A failure logs a code.
//   * Only what is needed is collected: a name, a phone number to reach the person, an optional e-mail, the reason, the language, and the agreement that the church team may contact them about it. No IP
//     address, no device data.
//   * Abuse: a honeypot, a size cap, a per-church flood cap, a per-number cap, and a repeat guard (the same form key, or the same number sending the same words, creates one row).

export const MAX_BODY_CHARS = 6_000;
export const NAME_MAX = 120;
export const REASON_MIN = 10;
export const REASON_MAX = 1000;
export const RATE = { churchPerHour: 20, phonePerHour: 3, phonePerDay: 5 } as const;

export interface CounsellingInput {
  username: string;
  submission_key: string;
  full_name: string;
  phone: string;
  email: string | null;
  reason: string;
  lang: "en" | "fr";
  /** true when the hidden honeypot field was filled: the caller answers "ok" and stores nothing. */
  bot: boolean;
}

const ALLOWED = ["username", "submission_key", "full_name", "phone", "email", "reason", "lang", "contact_consent", "website"] as const;
const USERNAME = /^[a-z0-9._-]{1,60}$/;
const EMAIL = /^[^\s@<>,;"()]+@[^\s@<>,;"()]+\.[^\s@<>,;"()]+$/;

export function parseCounsellingRequest(body: unknown): Checked<CounsellingInput> {
  const o = plainObject(body, ALLOWED);
  if (!o.ok) return o;
  const b = o.value;

  const username = typeof b.username === "string" ? b.username.trim().toLowerCase() : "";
  if (!USERNAME.test(username)) return { ok: false, code: "invalid_request", field: "username" };
  if (!isUuid(b.submission_key)) return { ok: false, code: "invalid_request", field: "submission_key" };

  const name = typeof b.full_name === "string" ? b.full_name.replace(/\s+/g, " ").trim() : "";
  if (name.length < 2 || name.length > NAME_MAX || /[\u0000-\u001f\u007f<>]/.test(name)) return { ok: false, code: "invalid_name", field: "full_name" };

  const phone = normalizeTestimonyPhone(b.phone);
  if (!phone) return { ok: false, code: "invalid_phone", field: "phone" };

  let email: string | null = null;
  if (has(b, "email") && b.email !== null && b.email !== undefined && b.email !== "") {
    const e = typeof b.email === "string" ? b.email.trim().toLowerCase() : "";
    if (e.length < 3 || e.length > 200 || !EMAIL.test(e)) return { ok: false, code: "invalid_email", field: "email" };
    email = e;
  }

  const r = optionalText(b.reason, "reason", REASON_MAX, true);
  if (!r.ok || r.value === null || r.value.length < REASON_MIN) return { ok: false, code: "invalid_reason", field: "reason" };

  const lang = has(b, "lang") ? b.lang : "en";
  if (lang !== "en" && lang !== "fr") return { ok: false, code: "invalid_request", field: "lang" };

  // the person must agree that the team may contact them about this request
  if (b.contact_consent !== true) return { ok: false, code: "consent_required", field: "contact_consent" };

  const bot = typeof b.website === "string" && b.website.trim() !== "";
  return { ok: true, value: { username, submission_key: b.submission_key, full_name: name, phone, email, reason: r.value, lang, bot } };
}

export type SubmitResult = { ok: true } | { ok: false; status: number; code: string };
type Admin = { from(table: string): any };
const isChurch = (p: any): boolean => !!p && (p.category === "church_ministries" || (Array.isArray(p.categories) && p.categories.includes("church_ministries")));

/** Stores one request for the church page `input.username`, or answers a plain refusal. Never returns an id, a count or anything about other requests. */
export async function submitCounselling(admin: Admin, input: CounsellingInput, now: number = Date.now()): Promise<SubmitResult> {
  if (input.bot) return { ok: true }; // a bot learns nothing: it gets the same answer and nothing is stored

  const { data: profile, error } = await admin.from("profiles").select("id, category, categories, published, is_demo").eq("username", input.username).maybeSingle();
  if (error) return { ok: false, status: 500, code: "server_error" };
  // the same answer for a missing page, an unpublished page, a demo page and a page that is not a church: nothing to probe
  if (!profile || profile.published !== true || profile.is_demo === true || !isChurch(profile)) return { ok: false, status: 404, code: "not_found" };
  const profileId: string = profile.id;
  // the church must offer counselling (its owner switched it on)
  const feature = await admin.from("church_features").select("counselling").eq("profile_id", profileId).maybeSingle();
  if (feature.error) return { ok: false, status: 500, code: "server_error" };
  if ((feature.data as { counselling?: boolean } | null)?.counselling !== true) return { ok: false, status: 404, code: "not_found" };

  // repeats: the same form key, or the same number sending the same words within a day, is one request
  const dupKey = await admin.from("church_counselling_requests").select("id").eq("profile_id", profileId).eq("submission_key", input.submission_key).limit(1);
  if (dupKey.error) return { ok: false, status: 500, code: "server_error" };
  if (Array.isArray(dupKey.data) && dupKey.data.length > 0) return { ok: true };
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const dupBody = await admin.from("church_counselling_requests").select("id").eq("profile_id", profileId).eq("phone", input.phone).eq("reason", input.reason).gte("created_at", dayAgo).limit(1);
  if (dupBody.error) return { ok: false, status: 500, code: "server_error" };
  if (Array.isArray(dupBody.data) && dupBody.data.length > 0) return { ok: true };

  // flood limits (counts only; nothing about the visitor is stored for this)
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const count = async (build: (q: any) => any): Promise<number | null> => {
    const r = await build(admin.from("church_counselling_requests").select("id", { count: "exact", head: true }).eq("profile_id", profileId));
    return r.error ? null : r.count ?? 0;
  };
  const [church, perHour, perDay] = await Promise.all([count((q) => q.gte("created_at", hourAgo)), count((q) => q.eq("phone", input.phone).gte("created_at", hourAgo)), count((q) => q.eq("phone", input.phone).gte("created_at", dayAgo))]);
  if (church === null || perHour === null || perDay === null) return { ok: false, status: 500, code: "server_error" };
  if (church >= RATE.churchPerHour || perHour >= RATE.phonePerHour || perDay >= RATE.phonePerDay) return { ok: false, status: 429, code: "too_many" };

  const { error: insertError } = await admin.from("church_counselling_requests").insert({
    id: globalThis.crypto.randomUUID(),
    profile_id: profileId,
    submission_key: input.submission_key,
    full_name: input.full_name,
    phone: input.phone,
    email: input.email,
    reason: input.reason,
    lang: input.lang,
  });
  if (insertError) {
    if (insertError.code === "23505") return { ok: true }; // two taps raced: the unique key kept it to one
    console.error(JSON.stringify({ scope: "church_counselling", result: "insert_error", code: String(insertError.code || "") })); // never the message: it can quote the person's words
    return { ok: false, status: 500, code: "server_error" };
  }
  return { ok: true };
}
