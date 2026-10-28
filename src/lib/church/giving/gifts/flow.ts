// Church giving, the money part: the gift flow. Start a payment, ask Fapshi, settle exactly once. Server only.
//
// The same discipline as the Shop checkout, in a SEPARATE lane:
//   * the browser supplies only the fund, the amount, who pays and what the donor chooses to share. The church, the rates and the status come from the server and the database, never from the request;
//   * a gift is paid ONLY after this server asked Fapshi for the transaction itself and was told SUCCESSFUL (the webhook-style "trust the body" shortcut does not exist here);
//   * settlement is one database function (church_settle_gift): it claims the gift as succeeded and records the one earning in a single transaction, so calling it twice, from two tabs or two sweeps, changes nothing;
//   * an amount Fapshi reports that differs from the gift sends it to payment_review instead of paid;
//   * a late confirmation of an expired attempt is honoured (the money is real); a late success after a recorded failure goes to a human.
// It talks to two small interfaces (GiftStore, PaymentProvider) so it is unit-tested with in-memory doubles and never needs Supabase or Fapshi to be tested.

import crypto from "crypto";
import type { PaymentProvider, RateLimiter } from "@/lib/productCheckout/types";
import {
  GIFT_LATE_LOOKBACK_HOURS,
  GIFT_WINDOW_MINUTES,
  formatGiftReceiptNumber,
  isUuid,
  parseGiftInput,
  stateOf,
  type GiftErrorCode,
  type GiftInput,
  type GiftKind,
  type GiftState,
  type GiftStatus,
} from "./rules";

export interface GiftSettings {
  fapshiEnabled: boolean;
  minGiftXaf: number;
  refundWindowHours: number;
}
export interface ChurchRow {
  id: string;
  username: string | null;
  name: string | null;
  published: boolean;
  isChurch: boolean;
  isDemo: boolean;
}
export interface FundRow {
  id: string;
  profile_id: string;
  kind: GiftKind;
  status: "draft" | "open" | "closed";
  is_published: boolean;
  title_en: string;
  title_fr: string;
}
export interface GiftRow {
  id: string;
  receipt_number: number;
  profile_id: string;
  fund_id: string;
  fund_kind: GiftKind;
  amount_xaf: number;
  is_anonymous: boolean;
  donor_name: string | null;
  donor_email: string | null;
  payer_phone: string;
  payer_medium: string | null;
  language: "en" | "fr";
  external_id: string;
  provider_transaction_id: string | null;
  status: GiftStatus;
  provider_status: string | null;
  failure_reason: string | null;
  access_token_hash: string;
  expires_at: string;
  confirmed_at: string | null;
  receipt_emailed_at: string | null;
  created_at: string;
}
export type NewGift = Omit<GiftRow, "receipt_number" | "confirmed_at" | "receipt_emailed_at" | "provider_transaction_id" | "provider_status" | "failure_reason"> & { donor_contact: string | null };
export type SettleResult = { status: "succeeded"; settled_now: boolean; earning: boolean } | { status: "review" } | { status: "not_found" };

/** Persistence boundary. (Donors cannot ask for refunds in Church Giving: a gift is a gift to the church. The refund tables and the administrator correction functions remain for records and corrections.)
 *   Every mutation is conditional so callers claim state exactly once. */
export interface GiftStore {
  getSettings(): Promise<GiftSettings>;
  getChurchByUsername(username: string): Promise<ChurchRow | null>;
  getChurch(profileId: string): Promise<ChurchRow | null>;
  getFund(id: string): Promise<FundRow | null>;
  givingSwitchedOn(profileId: string): Promise<boolean>;
  /** The database guard has the last word: a refusal says why in a short reason. */
  insertGift(row: NewGift): Promise<{ ok: true } | { ok: false; reason: "not_available" | "fund_unavailable" | "below_minimum" | "other" }>;
  getGift(id: string): Promise<GiftRow | null>;
  /** Only applies while the gift is in one of `expect`. Returns whether a row changed. */
  updateGift(id: string, patch: Partial<Pick<GiftRow, "status" | "provider_transaction_id" | "provider_status" | "failure_reason">>, expect: GiftStatus[]): Promise<boolean>;
  /** church_settle_gift(): atomic and idempotent. */
  settle(giftId: string, providerAmount: number | null): Promise<SettleResult>;
  /** Marks the receipt email as sent for the first caller only. */
  claimReceiptEmail(giftId: string): Promise<boolean>;
  /** Gifts a sweep should look at: open attempts first, then recently expired or cancelled ones. */
  listOpenGifts(args: { sinceIso: string; limit: number; profileId?: string }): Promise<GiftRow[]>;
}

export interface GiftDeps {
  store: GiftStore;
  provider: PaymentProvider;
  now: () => Date;
  newId: () => string;
  /** A random access token and its hash. The token is shown to the donor once; only the hash is stored. */
  newToken: () => { token: string; hash: string };
  pollGate?: { tryAcquire(transactionId: string, nowMs: number): boolean };
  limiter?: RateLimiter;
  /** Called once, by the caller that actually settled the gift. Best effort, never blocks settlement. */
  onGiftPaid?: (gift: GiftRow, church: ChurchRow | null) => Promise<void>;
  /** Server diagnostics. Must never include phone numbers, emails or names. */
  log: (event: string, data?: Record<string, unknown>) => void;
}

export type Result<T> = { ok: true; data: T } | { ok: false; code: GiftErrorCode };
const ok = <T>(data: T): Result<T> => ({ ok: true, data });
const fail = <T = never>(code: GiftErrorCode): Result<T> => ({ ok: false, code });

export const hashToken = (token: string): string => crypto.createHash("sha256").update(`ringo-church-gift-v1:${token}`).digest("hex");
export const createToken = (): { token: string; hash: string } => {
  const token = crypto.randomBytes(24).toString("hex");
  return { token, hash: hashToken(token) };
};
export function tokenMatches(gift: Pick<GiftRow, "access_token_hash">, token: unknown): boolean {
  if (typeof token !== "string" || token.length < 16 || token.length > 128) return false;
  const a = Buffer.from(hashToken(token), "hex"), b = Buffer.from(gift.access_token_hash, "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function within(deps: GiftDeps, kind: "pay_ip" | "pay_phone" | "pay_phone_day", subject: string | null | undefined): Promise<boolean> {
  if (!deps.limiter || !subject) return true;
  try {
    return await deps.limiter.hit(kind, subject);
  } catch (err) {
    deps.log("church_gift_rate_limit_error", { kind, error: String((err as Error)?.message || err).slice(0, 120) }); // fails open: a limiter outage must not block a genuine gift
    return true;
  }
}

export interface StartView {
  gift_id: string;
  access_token: string;
  expires_at: string;
  amount_xaf: number;
  receipt_number: string | null;
}

/** POST /api/public/church-gifts. Creates the gift row, then asks Fapshi to prompt the payer. Nothing is paid here. */
export async function startGift(deps: GiftDeps, raw: unknown, ctx: { clientKey?: string | null } = {}): Promise<Result<StartView>> {
  const settings = await deps.store.getSettings();
  const parsed = parseGiftInput(raw, settings.minGiftXaf);
  if (!parsed.ok) return fail(parsed.code);
  const input: GiftInput = parsed.value;
  const username = (raw as Record<string, unknown>).username;
  if (typeof username !== "string" || username.trim() === "" || username.length > 60) return fail("church_unavailable");
  if (!settings.fapshiEnabled) return fail("giving_unavailable");

  const church = await deps.store.getChurchByUsername(username.trim().toLowerCase());
  if (!church || !church.isChurch || !church.published || church.isDemo) return fail("church_unavailable");
  const fund = await deps.store.getFund(input.fundId);
  // The fund must belong to THIS church (the church comes from the page, never from the fund id the visitor sent).
  if (!fund || fund.profile_id !== church.id) return fail("fund_unavailable");
  if (fund.status !== "open" || !fund.is_published) return fail("fund_unavailable");
  if (!(await deps.store.givingSwitchedOn(church.id))) return fail("giving_unavailable");

  // Abuse limits, only once the request is otherwise valid so refused requests cost nothing. The payer number is free text: it is limited on its own so a stranger's phone cannot be flooded with prompts.
  if (!(await within(deps, "pay_ip", ctx.clientKey))) return fail("rate_limited");
  if (!(await within(deps, "pay_phone", input.phone))) return fail("rate_limited");
  if (!(await within(deps, "pay_phone_day", input.phone))) return fail("rate_limited");

  const now = deps.now();
  const id = deps.newId();
  const { token, hash } = deps.newToken();
  const expires = new Date(now.getTime() + GIFT_WINDOW_MINUTES * 60_000);
  const row: NewGift = {
    id,
    profile_id: church.id,
    fund_id: fund.id,
    fund_kind: fund.kind, // from the fund row, never from the request
    amount_xaf: input.amountXaf,
    is_anonymous: input.anonymous,
    donor_name: input.name,
    donor_contact: input.contact,
    donor_email: input.email,
    payer_phone: input.phone,
    payer_medium: input.medium,
    language: input.language,
    external_id: `cg-${id}`,
    status: "initiated",
    access_token_hash: hash,
    expires_at: expires.toISOString(),
    created_at: now.toISOString(),
  };
  const inserted = await deps.store.insertGift(row);
  if (!inserted.ok) return fail(inserted.reason === "fund_unavailable" ? "fund_unavailable" : inserted.reason === "below_minimum" ? "amount_below_minimum" : "giving_unavailable");

  let transId: string;
  try {
    const res = await deps.provider.directPay({
      amount: input.amountXaf,
      phone: input.phone,
      medium: input.medium,
      userId: id,
      externalId: row.external_id,
      message: `Ringo Connect — ${church.username ?? "church"}`,
    });
    if (!res?.transId) throw new Error("no transaction id returned");
    transId = res.transId;
  } catch (err) {
    deps.log("church_gift_direct_pay_failed", { giftId: id, error: String((err as Error)?.message || err).slice(0, 160) });
    await deps.store.updateGift(id, { status: "failed", failure_reason: "provider_error" }, ["initiated"]);
    return fail("payment_failed");
  }
  await deps.store.updateGift(id, { status: "pending", provider_transaction_id: transId, provider_status: "CREATED" }, ["initiated"]);
  return ok({ gift_id: id, access_token: token, expires_at: row.expires_at, amount_xaf: input.amountXaf, receipt_number: null });
}

export interface ReceiptView {
  receipt_number: string | null;
  church_name: string | null;
  church_username: string | null;
  fund_title_en: string | null;
  fund_title_fr: string | null;
  fund_kind: GiftKind;
  amount_xaf: number;
  /** The Fapshi fee is absorbed by Ringo: the donor pays exactly the amount. */
  fee_xaf: 0;
  currency: "XAF";
  confirmed_at: string | null;
  anonymous: boolean;
  donor_name: string | null;
  reference: string;
}
export interface GiftView {
  gift_id: string;
  state: GiftState;
  amount_xaf: number;
  expires_at: string;
  receipt?: ReceiptView;
}

async function buildView(deps: GiftDeps, gift: GiftRow): Promise<GiftView> {
  const state = stateOf(gift.status);
  const view: GiftView = { gift_id: gift.id, state, amount_xaf: gift.amount_xaf, expires_at: gift.expires_at };
  if (state === "succeeded") {
    const [church, fund] = await Promise.all([deps.store.getChurch(gift.profile_id), deps.store.getFund(gift.fund_id)]);
    view.receipt = {
      receipt_number: formatGiftReceiptNumber(gift.receipt_number),
      church_name: church?.name ?? null,
      church_username: church?.username ?? null,
      fund_title_en: fund?.title_en ?? null,
      fund_title_fr: fund?.title_fr ?? null,
      fund_kind: gift.fund_kind,
      amount_xaf: gift.amount_xaf,
      fee_xaf: 0,
      currency: "XAF",
      confirmed_at: gift.confirmed_at,
      anonymous: gift.is_anonymous,
      donor_name: gift.is_anonymous ? null : gift.donor_name,
      reference: gift.external_id,
    };
  }
  return view;
}

const isOpenAttempt = (g: GiftRow) => g.status === "initiated" || g.status === "pending";
const safeReason = (r: string | null | undefined) => (r ? r.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 200) || null : null);

/**
 * Asks Fapshi about a gift's transaction and moves the gift accordingly. Safe to call repeatedly (polling, refreshes, sweeps): every step is a conditional claim or the idempotent settlement.
 * Returns the gift as it stands afterwards.
 */
export async function refreshGift(deps: GiftDeps, gift: GiftRow): Promise<GiftRow> {
  const nowMs = deps.now().getTime();
  const reload = async () => (await deps.store.getGift(gift.id)) ?? gift;

  // A gift already recorded as succeeded: run settlement again (idempotent) so a crash between the two steps heals on the next call.
  if (gift.status === "succeeded") {
    await deps.store.settle(gift.id, null);
    return reload();
  }
  const cutoff = nowMs - GIFT_LATE_LOOKBACK_HOURS * 3_600_000;
  const askable = !!gift.provider_transaction_id && (isOpenAttempt(gift) || ((gift.status === "expired" || gift.status === "cancelled") && new Date(gift.created_at).getTime() > cutoff));
  if (!askable) {
    // an attempt that never got a transaction id and is past its window is finished
    if (isOpenAttempt(gift) && new Date(gift.expires_at).getTime() <= nowMs) await deps.store.updateGift(gift.id, { status: "expired" }, ["initiated", "pending"]);
    return reload();
  }
  // Fapshi allows a few status requests per minute per transaction: too soon since the last check -> answer from what we know (nothing changes).
  if (deps.pollGate && !deps.pollGate.tryAcquire(gift.provider_transaction_id as string, nowMs)) return gift;

  let tx: { status: string; amount: number | null; reason?: string | null };
  try {
    tx = await deps.provider.getStatus(gift.provider_transaction_id as string);
  } catch (err) {
    deps.log("church_gift_status_error", { giftId: gift.id, error: String((err as Error)?.message || err).slice(0, 160) });
    return gift; // unknown right now: stay as we are, try again next time
  }
  if (tx.status === "SUCCESSFUL") {
    const outcome = await deps.store.settle(gift.id, tx.amount);
    const after = await reload();
    if (outcome.status === "succeeded" && outcome.settled_now && deps.onGiftPaid) {
      try {
        if (await deps.store.claimReceiptEmail(gift.id)) await deps.onGiftPaid(after, await deps.store.getChurch(after.profile_id));
      } catch (err) {
        deps.log("church_gift_paid_hook_failed", { giftId: gift.id, error: String((err as Error)?.message || err).slice(0, 120) });
      }
    }
    if (outcome.status === "review") deps.log("church_gift_review", { giftId: gift.id, reason: after.failure_reason ?? "review" });
    return after;
  }
  if (tx.status === "FAILED") await deps.store.updateGift(gift.id, { status: "failed", provider_status: "FAILED", failure_reason: safeReason(tx.reason) }, ["initiated", "pending"]);
  else if (tx.status === "EXPIRED") await deps.store.updateGift(gift.id, { status: "expired", provider_status: "EXPIRED" }, ["initiated", "pending"]);
  else if (isOpenAttempt(gift) && new Date(gift.expires_at).getTime() <= nowMs) await deps.store.updateGift(gift.id, { status: "expired", provider_status: String(tx.status) }, ["initiated", "pending"]);
  return reload();
}

/** GET /api/public/church-gifts/[id]?t=token. The token is the donor's key; a wrong token looks exactly like a missing gift. */
export async function checkGift(deps: GiftDeps, giftId: string, token: unknown): Promise<Result<GiftView>> {
  if (!isUuid(giftId)) return fail("gift_not_found");
  const gift = await deps.store.getGift(giftId);
  if (!gift || !tokenMatches(gift, token)) return fail("gift_not_found");
  const after = await refreshGift(deps, gift);
  return ok(await buildView(deps, after));
}

/** A sweep over open and recently expired gifts (the reconciliation job and the dashboard "check pending" button). Bounded, one status request per gift per run. */
export async function reconcileGifts(deps: GiftDeps, opts: { profileId?: string; limit?: number; budgetMs?: number } = {}): Promise<{ checked: number; settled: number; failed: number; stillPending: number }> {
  const started = deps.now().getTime();
  const budget = opts.budgetMs ?? 40_000;
  const since = new Date(started - GIFT_LATE_LOOKBACK_HOURS * 3_600_000).toISOString();
  const open = await deps.store.listOpenGifts({ sinceIso: since, limit: Math.min(Math.max(opts.limit ?? 25, 1), 100), profileId: opts.profileId });
  const out = { checked: 0, settled: 0, failed: 0, stillPending: 0 };
  for (const g of open) {
    if (deps.now().getTime() - started > budget) break;
    const after = await refreshGift(deps, g);
    out.checked++;
    if (after.status === "succeeded") out.settled++;
    else if (after.status === "failed") out.failed++;
    else if (after.status === "pending" || after.status === "initiated") out.stillPending++;
  }
  return out;
}
