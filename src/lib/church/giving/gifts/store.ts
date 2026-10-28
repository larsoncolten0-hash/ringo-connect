// Church giving, the money part: the Supabase implementation of GiftStore. SERVER ONLY, with the service-role client: a visitor has no account, and no API role may write the gift tables. The caller (a route)
// has already decided what is allowed; every mutation below is also conditional (it applies only from the expected status) and the database guards (2027-01-12_church_gifts.sql) have the last word.
// It reads and writes ONLY the church tables. It never touches product_orders, customer_payments, commerce_sale_earnings or commerce_payouts.

import { GIFT_MIN_XAF, GIFT_REFUND_WINDOW_HOURS } from "./rules";
import type { ChurchRow, FundRow, GiftRow, GiftSettings, GiftStore, NewGift, SettleResult } from "./flow";

type Admin = any;

const GIFT_COLS =
  "id, receipt_number, profile_id, fund_id, fund_kind, amount_xaf, is_anonymous, donor_name, donor_email, payer_phone, payer_medium, language, external_id, provider_transaction_id, status, provider_status, failure_reason, access_token_hash, expires_at, confirmed_at, receipt_emailed_at, created_at";

const msg = (e: any): string => String(e?.message || "");

export function createSupabaseGiftStore(admin: Admin): GiftStore {
  const church = (p: any): ChurchRow | null =>
    p
      ? {
          id: p.id,
          username: p.username ?? null,
          name: p.name ?? null,
          published: p.published === true,
          isChurch: p.category === "church_ministries" || (Array.isArray(p.categories) && p.categories.includes("church_ministries")),
          isDemo: p.is_demo === true,
        }
      : null;

  return {
    async getSettings(): Promise<GiftSettings> {
      const { data, error } = await admin.from("platform_settings").select("fapshi_enabled, church_min_gift_xaf, church_gift_refund_window_hours").limit(1).single();
      // Fails CLOSED: if the church settings cannot be read (e.g. the migration is not applied), giving is simply unavailable.
      if (error || !data) return { fapshiEnabled: false, minGiftXaf: GIFT_MIN_XAF, refundWindowHours: GIFT_REFUND_WINDOW_HOURS };
      return {
        fapshiEnabled: data.fapshi_enabled === true,
        minGiftXaf: Number.isInteger(data.church_min_gift_xaf) ? Math.max(data.church_min_gift_xaf, GIFT_MIN_XAF) : GIFT_MIN_XAF,
        refundWindowHours: Number.isInteger(data.church_gift_refund_window_hours) ? data.church_gift_refund_window_hours : GIFT_REFUND_WINDOW_HOURS,
      };
    },

    async getChurchByUsername(username: string) {
      const { data } = await admin.from("profiles").select("id, username, name, published, category, categories, is_demo").eq("username", username).maybeSingle();
      return church(data);
    },

    async getChurch(profileId: string) {
      const { data } = await admin.from("profiles").select("id, username, name, published, category, categories, is_demo").eq("id", profileId).maybeSingle();
      return church(data);
    },

    async getFund(id: string): Promise<FundRow | null> {
      const { data } = await admin.from("church_giving_funds").select("id, profile_id, kind, status, is_published, title_en, title_fr").eq("id", id).maybeSingle();
      return (data as FundRow) ?? null;
    },

    async givingSwitchedOn(profileId: string) {
      const { data } = await admin.from("church_features").select("giving").eq("profile_id", profileId).maybeSingle();
      return data?.giving === true;
    },

    async insertGift(row: NewGift) {
      const { error } = await admin.from("church_gifts").insert(row);
      if (!error) return { ok: true as const };
      const m = msg(error);
      if (m.includes("giving_collection_not_available") || m.includes("gift_giving_not_enabled")) return { ok: false as const, reason: "not_available" as const };
      if (m.includes("gift_fund_not_open") || m.includes("gift_fund_kind_mismatch")) return { ok: false as const, reason: "fund_unavailable" as const };
      if (m.includes("gift_below_minimum")) return { ok: false as const, reason: "below_minimum" as const };
      return { ok: false as const, reason: "other" as const };
    },

    async getGift(id: string): Promise<GiftRow | null> {
      const { data } = await admin.from("church_gifts").select(GIFT_COLS).eq("id", id).maybeSingle();
      return (data as GiftRow) ?? null;
    },

    async updateGift(id, patch, expect) {
      const { data, error } = await admin.from("church_gifts").update(patch).eq("id", id).in("status", expect).select("id");
      return !error && Array.isArray(data) && data.length > 0;
    },

    async settle(giftId: string, providerAmount: number | null): Promise<SettleResult> {
      const { data, error } = await admin.rpc("church_settle_gift", { p_gift_id: giftId, p_provider_amount: providerAmount });
      if (error || !data || typeof data !== "object") throw new Error(`church_settle_gift failed (${error?.code || "error"})`);
      return data as SettleResult;
    },

    async claimReceiptEmail(giftId: string) {
      const { data, error } = await admin.from("church_gifts").update({ receipt_emailed_at: new Date().toISOString() }).eq("id", giftId).is("receipt_emailed_at", null).select("id");
      return !error && Array.isArray(data) && data.length > 0;
    },

    async listOpenGifts({ sinceIso, limit, profileId }) {
      let q = admin
        .from("church_gifts")
        .select(GIFT_COLS)
        .in("status", ["initiated", "pending", "expired", "cancelled"])
        .not("provider_transaction_id", "is", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (profileId) q = q.eq("profile_id", profileId);
      const { data } = await q;
      return Array.isArray(data) ? (data as GiftRow[]) : [];
    },
  };
}
