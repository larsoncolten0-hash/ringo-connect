// Contact-detail provenance (STRICT). A WhatsApp number, phone number or
// email may go into a draft only if the OWNER typed it earlier in this
// conversation. The model can never invent or infer one: these checks run
// on the server against the owner's own stored messages, not model text.
//
// The one normalization allowed for numbers: the owner typed the local
// number and the draft adds a REAL country calling code in front — one from
// Ringo's own list (src/lib/phoneCountryCodes.ts, the same list the WhatsApp
// field's country picker uses) — because WhatsApp needs the full
// international number in the digits-only format PhoneCountryInput stores.
// Every digit the owner typed must still be there, in order, at the end;
// arbitrary extra digits are never accepted.

import { PHONE_COUNTRIES } from "@/lib/phoneCountryCodes";

const DIAL_CODES = new Set(PHONE_COUNTRIES.map((c) => c.dial));

const PHONE_RUN = /\+?\d[\d\s().\-]{5,}\d/g;

function phoneRuns(text: string): string[] {
  return Array.from(text.matchAll(PHONE_RUN)).map((m) => m[0].replace(/\D/g, ""));
}

/** True when `digits` (digits only) is a number the owner typed, optionally with a country code added. */
export function phoneFromOwner(digits: string, ownerText: string[]): boolean {
  if (!/^\d{8,15}$/.test(digits)) return false;
  for (const text of ownerText) {
    for (const run of phoneRuns(text)) {
      if (run === digits) return true;
      if (run.length >= 8 && digits.length > run.length && digits.endsWith(run) && DIAL_CODES.has(digits.slice(0, digits.length - run.length))) return true;
    }
  }
  return false;
}

/** True when the owner typed this exact email address (case-insensitive). */
export function emailFromOwner(email: string, ownerText: string[]): boolean {
  const needle = email.trim().toLowerCase();
  if (!needle) return false;
  const pattern = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[^\s@<>()"',;:]+/g;
  return ownerText.some((text) =>
    Array.from(text.matchAll(pattern)).some((m) => m[0].replace(/[.)\]]+$/, "").toLowerCase() === needle)
  );
}
