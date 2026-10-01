// Business Toolkit Phase 6 (customers): possible matching Shop orders. PURE (no database, no network).
//
// A Shop order stores what the BUYER typed (name, phone, email). A contact (bk_customers) stores what the OWNER typed. Two records that share a
// normalised phone or email MIGHT be the same person; they might also be a family sharing a phone. So this never links, attaches or counts
// anything: it only describes, for the owner to judge, which orders share a key with a contact and why that may be ambiguous.
//
// NEVER used for matching: names (only displayed as typed), the order's customer_id, anything about a Ringo account.
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { ORDER_SCAN } from "./constants";

// ----------------------------------------------------------------------------------------------------------------------------------
// Faithful ports of the SQL helpers that stored bk_customers.phone_normalized / email_normalized (2026-12-03_debtors_reminders.sql):
//   bk_norm_phone: digits only, one leading "00" dropped, 9 digits starting 6 or 2 get "237", otherwise 7-15 digits, otherwise null.
//   bk_norm_email: lower(btrim(...)); null if "@" is missing or first, longer than 200 characters, or contains whitespace.
// A parity test runs both over one corpus on a real PostgreSQL engine (scripts/tests/customersNormParity.test.mjs).
// ----------------------------------------------------------------------------------------------------------------------------------
export function normalizePhone(input: unknown): string | null {
  const raw = typeof input === "string" ? input : "";
  const d = raw.replace(/[^0-9]/g, "").replace(/^00/, "");
  if (d === "") return null;
  if (d.length === 9 && (d[0] === "6" || d[0] === "2")) return "237" + d;
  if (d.length >= 7 && d.length <= 15) return d;
  return null;
}

export function normalizeEmail(input: unknown): string | null {
  const raw = typeof input === "string" ? input : "";
  const e = raw.replace(/^ +| +$/g, "").toLowerCase(); // btrim removes SPACES only (not tabs or newlines)
  // Postgres' \s is [[:space:]]: the ASCII whitespace set (a non-breaking space is NOT whitespace there, unlike JavaScript's \s)
  if (e === "" || e.indexOf("@") <= 0 || Array.from(e).length > 200 || /[ \t\n\v\f\r]/.test(e)) return null;
  return e;
}

export type ContactKeys = { id: string; phone_normalized: string | null; email_normalized: string | null; archived?: boolean };
export type OrderRow = {
  id: string; order_number: number | string | null; status: string; total: string | number | null; currency: string;
  created_at: string; paid_at: string | null; customer_name: string | null; customer_phone: string | null; customer_email: string | null;
};

export type MatchBasis = "both" | "phone" | "email";
/** Ambiguity warnings shown next to an order. They never remove the order: the owner decides. */
export type OrderWarning =
  | "email_belongs_to_other_contact" | "phone_belongs_to_other_contact"      // the order's other key is an ACTIVE contact's
  | "email_belongs_to_archived_contact" | "phone_belongs_to_archived_contact" // ... or an ARCHIVED contact's
  | "shared_phone_names" | "shared_email_names";                              // several different buyer names behind one phone / one e-mail

export type PossibleOrder = {
  id: string; order_number: number | string | null; status: string; created_at: string; paid_at: string | null;
  total_minor: number | null; currency: string; buyer_name: string | null; basis: MatchBasis; warnings: OrderWarning[];
};

export type MatchResult = {
  status: "ok" | "no_contact_key";
  items: PossibleOrder[];
  total_matches: number;
  shown: number;
  /** Whether a phone scan of the most recent orders was run at all (only for a contact WITH a usable phone). */
  phone_scanned: boolean;
  scanned_orders: number;
  /** The phone scan covers only the most recent orders: an older phone match may be missing (an email match is searched across all orders). Only ever true when phone_scanned. */
  window_full: boolean;
  /** The contact's phone/email is also on ANOTHER active contact (possible for an archived contact). */
  contact_key_shared_with_active: boolean;
  /** The contact's phone/email is also on an ARCHIVED contact of the same business (archived contacts free their keys, so this is allowed). */
  contact_key_shared_with_archived: boolean;
  /** Several different buyer names used the same phone among the matches. */
  shared_phone_names: boolean;
  /** Several different buyer names used the same e-mail among the matches. */
  shared_email_names: boolean;
  ambiguous: boolean;
};

const nameKey = (n: string | null) => (n ?? "").toLowerCase().replace(/\s+/g, " ").trim();

export function classifyOrders(args: {
  contact: { id: string; phone_normalized: string | null; email_normalized: string | null; archived: boolean };
  /** ALL contacts of the same business, active AND archived (their stored normalised keys): used only to detect that a key belongs to someone else. */
  contacts: ContactKeys[];
  orders: OrderRow[];
  /** True when a phone scan of the most recent orders was run (the contact has a usable phone). */
  phoneScanned: boolean;
  scannedOrders: number;
  windowFull: boolean;
  show?: number;
}): MatchResult {
  const { contact } = args;
  const phone = contact.phone_normalized, email = contact.email_normalized;
  const empty = (status: MatchResult["status"]): MatchResult => ({
    status, items: [], total_matches: 0, shown: 0, phone_scanned: args.phoneScanned, scanned_orders: args.scannedOrders, window_full: args.phoneScanned && args.windowFull,
    contact_key_shared_with_active: false, contact_key_shared_with_archived: false, shared_phone_names: false, shared_email_names: false, ambiguous: false,
  });
  if (!phone && !email) return empty("no_contact_key");

  const others = args.contacts.filter((c) => c.id !== contact.id);
  const ownedBy = (archived: boolean, key: "phone_normalized" | "email_normalized", value: string | null) => !!value && others.some((c) => !!c.archived === archived && c[key] === value);
  const keyShared = ownedBy(false, "phone_normalized", phone) || ownedBy(false, "email_normalized", email);
  const keySharedArchived = ownedBy(true, "phone_normalized", phone) || ownedBy(true, "email_normalized", email);

  type Hit = { o: OrderRow; basis: MatchBasis; orderPhone: string | null; orderEmail: string | null };
  const seen = new Set<string>();
  const hits: Hit[] = [];
  for (const o of args.orders) {
    if (seen.has(o.id)) continue;
    seen.add(o.id);
    const orderPhone = normalizePhone(o.customer_phone), orderEmail = normalizeEmail(o.customer_email);
    const byPhone = !!phone && orderPhone === phone, byEmail = !!email && orderEmail === email;
    if (!byPhone && !byEmail) continue;
    hits.push({ o, basis: byPhone && byEmail ? "both" : byPhone ? "phone" : "email", orderPhone, orderEmail });
  }

  // several different buyer names behind the matched phone, and (separately) behind the matched e-mail. Names are compared ONLY to warn about a shared key;
  // they never decide whether an order matches.
  const distinctNames = (pick: (b: MatchBasis) => boolean) => new Set(hits.filter((h) => pick(h.basis)).map((h) => nameKey(h.o.customer_name)).filter(Boolean)).size >= 2;
  const sharedNames = distinctNames((b) => b !== "email");
  const sharedEmailNames = distinctNames((b) => b !== "phone");

  const items: PossibleOrder[] = hits
    .map((h) => {
      const warnings: OrderWarning[] = [];
      // matched by phone, but the order's e-mail is a DIFFERENT contact's key - active or archived (and vice versa)
      if (h.basis === "phone" && ownedBy(false, "email_normalized", h.orderEmail)) warnings.push("email_belongs_to_other_contact");
      if (h.basis === "phone" && ownedBy(true, "email_normalized", h.orderEmail)) warnings.push("email_belongs_to_archived_contact");
      if (h.basis === "email" && ownedBy(false, "phone_normalized", h.orderPhone)) warnings.push("phone_belongs_to_other_contact");
      if (h.basis === "email" && ownedBy(true, "phone_normalized", h.orderPhone)) warnings.push("phone_belongs_to_archived_contact");
      if (sharedNames && h.basis !== "email") warnings.push("shared_phone_names");
      if (sharedEmailNames && h.basis !== "phone") warnings.push("shared_email_names");
      const digits = currencyMinorDigits(h.o.currency);
      return {
        id: h.o.id, order_number: h.o.order_number, status: h.o.status, created_at: h.o.created_at, paid_at: h.o.paid_at ?? null,
        total_minor: parseMinor(h.o.total, digits), currency: String(h.o.currency || "").toUpperCase(), buyer_name: h.o.customer_name ?? null,
        basis: h.basis, warnings,
      };
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : a.id < b.id ? 1 : -1));

  const shown = items.slice(0, args.show ?? ORDER_SCAN.show);
  return {
    status: "ok", items: shown, total_matches: items.length, shown: shown.length, phone_scanned: args.phoneScanned, scanned_orders: args.scannedOrders, window_full: args.phoneScanned && args.windowFull,
    contact_key_shared_with_active: keyShared, contact_key_shared_with_archived: keySharedArchived, shared_phone_names: sharedNames, shared_email_names: sharedEmailNames,
    ambiguous: keyShared || keySharedArchived || sharedNames || sharedEmailNames || items.some((i) => i.warnings.length > 0),
  };
}
