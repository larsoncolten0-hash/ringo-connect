// Church giving, the money part: the plain rules of a gift. Pure and dependency-free, safe in the browser and on the server. No Supabase, no Fapshi, no React.
//
// Approved terms (the owner's decisions): 5% Ringo commission on giving funds and a separate 5% on care funds (two settings, read at settlement time and snapshotted per gift), Ringo absorbs the
// Fapshi fee (the church's net is gross minus Ringo's commission, nothing else), a minimum gift of 500 XAF, XAF only, a receipt for every confirmed gift, anonymous giving allowed.
// The authoritative values live in the database (platform_settings and the guard triggers); the constants below are the safe defaults the screens show and the pre-checks use.

export const GIFT_MIN_XAF = 500;
/** A sanity ceiling so a typo cannot start a payment prompt for millions. Fapshi's own per-transaction limit must be confirmed before the pilot (see docs/church-giving-decisions.md). */
export const GIFT_MAX_XAF = 1_000_000;
/** How long one payment prompt stays live before the attempt is treated as expired locally (a late provider confirmation is still honoured). */
export const GIFT_WINDOW_MINUTES = 15;
/** Late provider confirmations are only looked for on attempts younger than this. */
export const GIFT_LATE_LOOKBACK_HOURS = 24;
export const GIFT_REFUND_WINDOW_HOURS = 48;
export const GIFT_MEDIUMS = ["mobile money", "orange money"] as const;
export type GiftMedium = (typeof GIFT_MEDIUMS)[number];
export type GiftStatus = "initiated" | "pending" | "succeeded" | "failed" | "expired" | "cancelled" | "payment_review" | "refunded";
export type GiftKind = "giving" | "care";

/** What the donor-facing screens may show: the state of the gift in four words. */
export type GiftState = "pending" | "succeeded" | "failed" | "expired" | "review" | "refunded";

export const stateOf = (status: GiftStatus): GiftState => {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "expired":
    case "cancelled":
      return "expired";
    case "payment_review":
      return "review";
    case "refunded":
      return "refunded";
    default:
      return "pending";
  }
};

export interface GiftEarnings {
  gross: number;
  platformFee: number;
  net: number;
  rate: number;
}

/**
 * gross x rate, rounded half-up to a WHOLE XAF (XAF has no subunit), on integers. The rate is numeric(5,4), i.e. whole basis points, so the arithmetic is exact. null when the inputs are unusable.
 * Guarantees gross === platformFee + net. The SQL function church_settle_gift() computes the same number (floor(gross * rate + 0.5)); the tests compare the two.
 */
export function computeGiftEarnings(amountXaf: unknown, rate: unknown): GiftEarnings | null {
  if (typeof amountXaf !== "number" || !Number.isInteger(amountXaf) || amountXaf <= 0 || amountXaf > 10_000_000) return null;
  const r = typeof rate === "string" ? Number(rate) : (rate as number);
  if (typeof r !== "number" || !Number.isFinite(r) || r < 0 || r > 1) return null;
  const basisPoints = Math.round(r * 10000);
  const scaled = amountXaf * basisPoints + 5000; // + half a unit => round half up
  const fee = (scaled - (scaled % 10000)) / 10000;
  return { gross: amountXaf, platformFee: fee, net: amountXaf - fee, rate: basisPoints / 10000 };
}

/** The receipt number a donor sees, from the database sequence: CG-000123. */
export const formatGiftReceiptNumber = (n: unknown): string | null => (typeof n === "number" && Number.isInteger(n) && n > 0 ? `CG-${String(n).padStart(6, "0")}` : null);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f<>]/g;
const clean = (s: string) => s.replace(CONTROL, " ").replace(/\s+/g, " ").trim();

/** Digits only, without a leading Cameroon country code (the same rule the Shop checkout uses for a payer number). */
export function normalizePayerPhone(phone: string): string {
  let digits = phone.replace(/[^0-9]/g, "");
  if (digits.startsWith("237") && digits.length > 9) digits = digits.slice(3);
  return digits;
}

export type GiftErrorCode =
  | "invalid_request"
  | "invalid_fund"
  | "invalid_amount"
  | "amount_below_minimum"
  | "amount_above_maximum"
  | "invalid_phone"
  | "invalid_payment_medium"
  | "invalid_name"
  | "invalid_contact"
  | "invalid_email"
  | "invalid_language"
  | "giving_unavailable"
  | "fund_unavailable"
  | "church_unavailable"
  | "rate_limited"
  | "gift_not_found"
  | "payment_failed"
  | "server_error";

export const GIFT_HTTP_STATUS: Record<GiftErrorCode, number> = {
  invalid_request: 400,
  invalid_fund: 400,
  invalid_amount: 400,
  amount_below_minimum: 400,
  amount_above_maximum: 400,
  invalid_phone: 400,
  invalid_payment_medium: 400,
  invalid_name: 400,
  invalid_contact: 400,
  invalid_email: 400,
  invalid_language: 400,
  giving_unavailable: 409,
  fund_unavailable: 409,
  church_unavailable: 404,
  rate_limited: 429,
  gift_not_found: 404,
  payment_failed: 502,
  server_error: 500,
};

export interface GiftInput {
  fundId: string;
  amountXaf: number;
  phone: string;
  medium: GiftMedium;
  anonymous: boolean;
  name: string | null;
  contact: string | null;
  email: string | null;
  language: "en" | "fr";
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; code: GiftErrorCode; field?: string };
const bad = (code: GiftErrorCode, field?: string): Parsed<never> => ({ ok: false, code, ...(field ? { field } : {}) });
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const KNOWN = new Set(["fund_id", "amount_xaf", "phone", "medium", "is_anonymous", "donor_name", "donor_contact", "donor_email", "language", "username", "website"]);

/**
 * The visitor's request, checked field by field. NOTHING about the church, the commission, the fee, the status or the payment comes from here: only the fund, the amount, who pays and how, and what the
 * donor chooses to share. `minimumXaf` is the live setting (the database enforces it again). An anonymous gift carries no name and no contact. A hidden "website" field must be empty (bots fill it).
 */
export function parseGiftInput(raw: unknown, minimumXaf: number = GIFT_MIN_XAF): Parsed<GiftInput> {
  if (!isObject(raw)) return bad("invalid_request");
  for (const k of Object.keys(raw)) if (!KNOWN.has(k)) return bad("invalid_request", k);
  if (typeof raw.website === "string" && raw.website.trim() !== "") return bad("invalid_request", "website");
  if (!isUuid(raw.fund_id)) return bad("invalid_fund", "fund_id");
  const amount = raw.amount_xaf;
  if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0) return bad("invalid_amount", "amount_xaf");
  if (amount < minimumXaf) return bad("amount_below_minimum", "amount_xaf");
  if (amount > GIFT_MAX_XAF) return bad("amount_above_maximum", "amount_xaf");
  if (raw.medium !== "mobile money" && raw.medium !== "orange money") return bad("invalid_payment_medium", "medium");
  if (typeof raw.phone !== "string") return bad("invalid_phone", "phone");
  const phone = normalizePayerPhone(raw.phone);
  if (!/^6\d{8}$/.test(phone)) return bad("invalid_phone", "phone");
  const anonymous = raw.is_anonymous === true;
  if (raw.is_anonymous !== undefined && typeof raw.is_anonymous !== "boolean") return bad("invalid_request", "is_anonymous");
  const language = raw.language === undefined ? "en" : raw.language;
  if (language !== "en" && language !== "fr") return bad("invalid_language", "language");

  const text = (v: unknown, field: string, code: GiftErrorCode, max: number): Parsed<string | null> => {
    if (v === undefined || v === null || v === "") return { ok: true, value: null };
    if (typeof v !== "string") return bad(code, field);
    const s = clean(v);
    if (s === "") return { ok: true, value: null };
    return s.length <= max ? { ok: true, value: s } : bad(code, field);
  };
  const name = text(raw.donor_name, "donor_name", "invalid_name", 120);
  if (!name.ok) return name;
  const contact = text(raw.donor_contact, "donor_contact", "invalid_contact", 120);
  if (!contact.ok) return contact;
  const email = text(raw.donor_email, "donor_email", "invalid_email", 200);
  if (!email.ok) return email;
  if (email.value !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.value)) return bad("invalid_email", "donor_email");
  return {
    ok: true,
    value: { fundId: raw.fund_id, amountXaf: amount, phone, medium: raw.medium, anonymous, name: anonymous ? null : name.value, contact: anonymous ? null : contact.value, email: email.value, language },
  };
}

/** Is a refund request still allowed? Inside the window counted from the confirmation. The database enforces the same rule again. */
export function refundWindowOpen(confirmedAtIso: string | null, nowMs: number, windowHours: number = GIFT_REFUND_WINDOW_HOURS): boolean {
  if (!confirmedAtIso) return false;
  const t = new Date(confirmedAtIso).getTime();
  return Number.isFinite(t) && nowMs <= t + windowHours * 3_600_000;
}
