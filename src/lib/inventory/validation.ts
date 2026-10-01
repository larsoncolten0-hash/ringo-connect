// Request validation for the Phase 4 API: a fast, friendly pre-check. The database functions re-validate everything and stay the authority.
// The browser never sends a stored quantity: only an operation and an amount, and every quantity here is a whole number of units.
import { isUuid, type Parsed } from "@/lib/documents/validation";
import { ADJUST_KINDS, STOCK_LIMITS, type AdjustKind } from "./constants";

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const len = (s: string) => Array.from(s).length;
const int = (v: unknown): number | null => (typeof v === "number" && Number.isInteger(v) ? v : null);

function text(v: unknown, max: number, code: string, errors: string[]): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string" || len(v) > max) { errors.push(code); return null; }
  return v.trim() === "" ? null : v;
}

/** An exact decimal (never a float): digits with up to 3 decimals; the database checks the per-currency scale. */
function cost(v: unknown, errors: string[]): string | null {
  if (v === undefined || v === null || v === "") return null;
  const s = typeof v === "number" && Number.isFinite(v) ? String(v) : typeof v === "string" ? v.trim().replace(",", ".") : "";
  if (!/^\d{1,11}(\.\d{1,3})?$/.test(s)) { errors.push("invalid_unit_cost"); return null; }
  return s;
}

const requestId = (b: Record<string, unknown>, errors: string[]): string | null => (isUuid(b.client_request_id) ? b.client_request_id : (errors.push("request_id_required"), null));

export type StartInput = { opening_quantity: number | null; low_stock_threshold: number | null; client_request_id: string };
export function parseStartBody(body: unknown): Parsed<StartInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  let opening: number | null = null;
  if (body.opening_quantity !== undefined && body.opening_quantity !== null) {
    opening = int(body.opening_quantity);
    if (opening === null || opening < 0 || opening > STOCK_LIMITS.maxCount) { errors.push("invalid_quantity"); opening = null; }
  }
  let threshold: number | null = null;
  if (body.low_stock_threshold !== undefined && body.low_stock_threshold !== null) {
    threshold = int(body.low_stock_threshold);
    if (threshold === null || threshold < 0 || threshold > STOCK_LIMITS.maxThreshold) { errors.push("invalid_threshold"); threshold = null; }
  }
  const rid = requestId(body, errors);
  return errors.length ? { ok: false, details: errors } : { ok: true, value: { opening_quantity: opening, low_stock_threshold: threshold, client_request_id: rid as string } };
}

export type AdjustInput = { kind: AdjustKind; quantity: number; reason: string | null; note: string | null; unit_cost: string | null; invoice_id: string | null; client_request_id: string };
export function parseAdjustBody(body: unknown): Parsed<AdjustInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  if (!(ADJUST_KINDS as readonly unknown[]).includes(body.kind)) errors.push("invalid_kind");
  const quantity = int(body.quantity);
  if (quantity === null || quantity < 1 || quantity > STOCK_LIMITS.maxAdjust) errors.push("invalid_quantity");
  const reason = text(body.reason, STOCK_LIMITS.reason, "invalid_reason", errors);
  const note = text(body.note, STOCK_LIMITS.note, "invalid_note", errors);
  const unit_cost = cost(body.unit_cost, errors);
  let invoice: string | null = null;
  if (body.invoice_id !== undefined && body.invoice_id !== null) { if (isUuid(body.invoice_id)) invoice = body.invoice_id; else errors.push("invalid_source"); }
  const rid = requestId(body, errors);
  return errors.length
    ? { ok: false, details: errors }
    : { ok: true, value: { kind: body.kind as AdjustKind, quantity: quantity as number, reason, note, unit_cost, invoice_id: invoice, client_request_id: rid as string } };
}

export type CountInput = { target: number; reason: string | null; note: string | null; client_request_id: string };
export function parseCountBody(body: unknown): Parsed<CountInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  const target = int(body.target);
  if (target === null || target < 0 || target > STOCK_LIMITS.maxCount) errors.push("invalid_quantity");
  const reason = text(body.reason, STOCK_LIMITS.reason, "invalid_reason", errors);
  const note = text(body.note, STOCK_LIMITS.note, "invalid_note", errors);
  const rid = requestId(body, errors);
  return errors.length ? { ok: false, details: errors } : { ok: true, value: { target: target as number, reason, note, client_request_id: rid as string } };
}

export type RestockInput = { order_id: string; quantity: number; note: string | null; client_request_id: string };
export function parseRestockBody(body: unknown): Parsed<RestockInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  if (!isUuid(body.order_id)) errors.push("order_not_found");
  const quantity = int(body.quantity);
  if (quantity === null || quantity < 1 || quantity > STOCK_LIMITS.maxAdjust) errors.push("invalid_quantity");
  const note = text(body.note, STOCK_LIMITS.note, "invalid_note", errors);
  const rid = requestId(body, errors);
  return errors.length ? { ok: false, details: errors } : { ok: true, value: { order_id: body.order_id as string, quantity: quantity as number, note, client_request_id: rid as string } };
}

export type StopInput = { note: string | null; client_request_id: string };
export function parseStopBody(body: unknown): Parsed<StopInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  const note = text(body.note, STOCK_LIMITS.note, "invalid_note", errors);
  const rid = requestId(body, errors);
  return errors.length ? { ok: false, details: errors } : { ok: true, value: { note, client_request_id: rid as string } };
}

export type SettingsInput = { low_stock_threshold: number; sku: string | null; unit_cost: string | null };
export function parseSettingsBody(body: unknown): Parsed<SettingsInput> {
  if (!isObj(body)) return { ok: false, details: ["invalid_body"] };
  const errors: string[] = [];
  const threshold = int(body.low_stock_threshold);
  if (threshold === null || threshold < 0 || threshold > STOCK_LIMITS.maxThreshold) errors.push("invalid_threshold");
  const sku = text(body.sku, STOCK_LIMITS.sku, "invalid_sku", errors);
  const unit_cost = cost(body.unit_cost, errors);
  return errors.length ? { ok: false, details: errors } : { ok: true, value: { low_stock_threshold: threshold as number, sku, unit_cost } };
}
