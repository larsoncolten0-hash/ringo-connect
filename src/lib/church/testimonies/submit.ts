import { has, isUuid, optionalText, plainObject, type Checked } from "../validation";
import { TESTIMONY_MAX } from "./limits";

// Churches & Ministries Testimonies: what a VISITOR sends. Pure validation plus the one server-side submission step. No React.
//
//   * A visitor needs no account. The route that calls this is public by design, so everything is re-derived here: the church comes from the public page's own username and is verified to be a PUBLISHED
//     church page (never an id from the client), every field is validated and cleaned, and the answer is the same plain "ok" for a new, a repeated and a spam submission, so it reveals nothing.
//   * The service-role client is handed in by the route (this file never creates one). It is the only way in: no API role can insert into the table, and none can read it.
//   * Consent is taken exactly as ticked: publication consent defaults to false, name consent exists only with publication consent, and submitting is never treated as permission to publish.
//   * Abuse: a honeypot, a size cap, a per-church flood cap, a per-number cap, and a repeat guard (the same form key, or the same number sending the same words, creates one row).
//   * Only the details needed are collected: a name, a phone number to reach the person, an optional group label, the words, the language and the two consent ticks. No IP address, no device data.

export const MAX_BODY_CHARS = 12_000;
export const NAME_MAX = 120;
export const GROUP_MAX = 80;
export const TESTIMONY_MIN = 10;
export { TESTIMONY_MAX } from "./limits";
/** Per church, per hour; per number per church, per hour and per day. */
export const RATE = { churchPerHour: 40, phonePerHour: 3, phonePerDay: 8 } as const;

export interface TestimonyInput {
  username: string;
  submission_key: string;
  full_name: string;
  phone: string;
  group_label: string | null;
  body: string;
  lang: "en" | "fr";
  publish_consent: boolean;
  name_consent: boolean;
  /** true when the hidden honeypot field was filled: the caller answers "ok" and stores nothing. */
  bot: boolean;
}

const ALLOWED = ["username", "submission_key", "full_name", "phone", "group_label", "body", "lang", "publish_consent", "name_consent", "website"] as const;
const USERNAME = /^[a-z0-9._-]{1,60}$/;

/** Digits only, international form without "+" or "00". A 9-digit Cameroon mobile or landline typed without the country code gets 237. 8 to 15 digits, never one repeated digit. */
export function normalizeTestimonyPhone(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 40) return null;
  if (!/^[+\d\s().-]+$/.test(v)) return null;
  let d = v.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 9 && /^[62]/.test(d)) d = `237${d}`;
  if (!/^\d{8,15}$/.test(d) || /^(\d)\1+$/.test(d)) return null;
  return d;
}

export function parseSubmission(body: unknown): Checked<TestimonyInput> {
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

  let group: string | null = null;
  if (has(b, "group_label") && b.group_label !== null && b.group_label !== undefined && b.group_label !== "") {
    const g = optionalText(b.group_label, "group_label", GROUP_MAX, false);
    if (!g.ok) return { ok: false, code: "invalid_group", field: "group_label" };
    group = g.value;
  }

  const t = optionalText(b.body, "body", TESTIMONY_MAX, true);
  if (!t.ok || t.value === null || t.value.length < TESTIMONY_MIN) return { ok: false, code: "invalid_testimony", field: "body" };

  const lang = has(b, "lang") ? b.lang : "en";
  if (lang !== "en" && lang !== "fr") return { ok: false, code: "invalid_request", field: "lang" };

  const publish = has(b, "publish_consent") ? b.publish_consent : false;
  const nameConsent = has(b, "name_consent") ? b.name_consent : false;
  if (typeof publish !== "boolean" || typeof nameConsent !== "boolean") return { ok: false, code: "invalid_consent", field: "publish_consent" };
  if (nameConsent && !publish) return { ok: false, code: "invalid_consent", field: "name_consent" };

  const bot = typeof b.website === "string" && b.website.trim() !== "";
  return { ok: true, value: { username, submission_key: b.submission_key, full_name: name, phone, group_label: group, body: t.value, lang, publish_consent: publish, name_consent: nameConsent, bot } };
}

export type SubmitResult = { ok: true } | { ok: false; status: number; code: string };
type Admin = { from(table: string): any };
const isChurch = (p: any): boolean => !!p && (p.category === "church_ministries" || (Array.isArray(p.categories) && p.categories.includes("church_ministries")));

/** Stores one testimony for the church page `input.username`, or answers a plain refusal. Never returns an id, a count or anything about other submissions. */
export async function submitTestimony(admin: Admin, input: TestimonyInput, now: number = Date.now()): Promise<SubmitResult> {
  if (input.bot) return { ok: true }; // a bot learns nothing: it gets the same answer and nothing is stored

  const { data: profile, error } = await admin.from("profiles").select("id, category, categories, published").eq("username", input.username).maybeSingle();
  if (error) return { ok: false, status: 500, code: "server_error" };
  // the same answer for a missing page, an unpublished page and a page that is not a church: nothing to probe
  if (!profile || profile.published !== true || !isChurch(profile)) return { ok: false, status: 404, code: "not_found" };
  const profileId: string = profile.id;

  // repeats: the same form key, or the same number sending the same words within a day, is one testimony
  const dupKey = await admin.from("ministry_testimonies").select("id").eq("profile_id", profileId).eq("submission_key", input.submission_key).limit(1);
  if (dupKey.error) return { ok: false, status: 500, code: "server_error" };
  if (Array.isArray(dupKey.data) && dupKey.data.length > 0) return { ok: true };
  const dayAgo = new Date(now - 86_400_000).toISOString();
  const dupBody = await admin.from("ministry_testimonies").select("id").eq("profile_id", profileId).eq("phone", input.phone).eq("body", input.body).gte("created_at", dayAgo).limit(1);
  if (dupBody.error) return { ok: false, status: 500, code: "server_error" };
  if (Array.isArray(dupBody.data) && dupBody.data.length > 0) return { ok: true };

  // flood limits (counts only; nothing about the visitor is stored for this)
  const hourAgo = new Date(now - 3_600_000).toISOString();
  const count = async (build: (q: any) => any): Promise<number | null> => {
    const r = await build(admin.from("ministry_testimonies").select("id", { count: "exact", head: true }).eq("profile_id", profileId));
    return r.error ? null : r.count ?? 0;
  };
  const [church, perHour, perDay] = await Promise.all([count((q) => q.gte("created_at", hourAgo)), count((q) => q.eq("phone", input.phone).gte("created_at", hourAgo)), count((q) => q.eq("phone", input.phone).gte("created_at", dayAgo))]);
  if (church === null || perHour === null || perDay === null) return { ok: false, status: 500, code: "server_error" };
  if (church >= RATE.churchPerHour || perHour >= RATE.phonePerHour || perDay >= RATE.phonePerDay) return { ok: false, status: 429, code: "too_many" };

  const { error: insertError } = await admin.from("ministry_testimonies").insert({
    id: globalThis.crypto.randomUUID(),
    profile_id: profileId,
    submission_key: input.submission_key,
    full_name: input.full_name,
    phone: input.phone,
    group_label: input.group_label,
    body: input.body,
    lang: input.lang,
    publish_consent: input.publish_consent,
    name_consent: input.name_consent,
  });
  if (insertError) {
    if (insertError.code === "23505") return { ok: true }; // two taps raced: the unique key kept it to one
    console.error(JSON.stringify({ scope: "church_testimony", result: "insert_error", code: String(insertError.code || "") })); // never the message: it can quote the person's words
    return { ok: false, status: 500, code: "server_error" };
  }
  return { ok: true };
}
