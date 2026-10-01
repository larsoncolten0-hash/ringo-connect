// Display formatting for documents. Built from integer minor units by string grouping — no Intl and no floating point —
// so the output is exact, deterministic across devices, and contains ONLY ASCII (French-locale Intl output contains U+202F,
// which the PDF fonts cannot encode).
//   fr: "12 000 FCFA" · "1 234,50 USD" · "1,234 KWD"     en: "FCFA 12,000" · "USD 1,234.50"
import { currencyMinorDigits } from "@/lib/bookkeeping/money";
import type { DocumentLocale } from "./constants";

const CFA = new Set(["XAF", "XOF"]);

export function currencyLabel(currency: string): string {
  const c = String(currency || "").toUpperCase();
  return CFA.has(c) ? "FCFA" : c || "";
}

function group(int: string, sep: string): string {
  let out = "";
  for (let i = 0; i < int.length; i++) {
    if (i > 0 && (int.length - i) % 3 === 0) out += sep;
    out += int[i];
  }
  return out;
}

export function formatNumberMinor(minor: number, digits: number, locale: DocumentLocale): string {
  if (!Number.isSafeInteger(minor)) return "?";
  const neg = minor < 0;
  const s = String(Math.abs(minor)).padStart(digits + 1, "0");
  const int = digits === 0 ? s : s.slice(0, s.length - digits);
  const frac = digits === 0 ? "" : s.slice(s.length - digits);
  const body = locale === "fr" ? group(int, " ") + (frac ? "," + frac : "") : group(int, ",") + (frac ? "." + frac : "");
  return (neg ? "-" : "") + body;
}

export function formatMoney(minor: number, currency: string, locale: DocumentLocale): string {
  const digits = currencyMinorDigits(currency);
  const n = formatNumberMinor(minor, digits, locale);
  const label = currencyLabel(currency);
  return locale === "fr" ? `${n} ${label}`.trim() : `${label} ${n}`.trim();
}

/** Quantity given in thousandths: "2", "2.5" / "2,5", "0.125". */
export function formatQuantityMilli(milli: number, locale: DocumentLocale): string {
  if (!Number.isSafeInteger(milli)) return "?";
  const whole = Math.trunc(milli / 1000);
  const frac = String(milli % 1000).padStart(3, "0").replace(/0+$/, "");
  return String(whole) + (frac ? (locale === "fr" ? "," : ".") + frac : "");
}

const MONTHS: Record<DocumentLocale, string[]> = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
};

/** "2026-10-01" -> "1 Oct 2026" / "1 oct. 2026". Anything that is not a date key is returned as an empty string. */
export function formatDateKey(key: string | null | undefined, locale: DocumentLocale): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || "");
  if (!m) return "";
  const month = Number(m[2]);
  if (month < 1 || month > 12) return "";
  return `${Number(m[3])} ${MONTHS[locale][month - 1]} ${m[1]}`;
}
