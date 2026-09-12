"use client";

import { useState } from "react";
import { PHONE_COUNTRIES, flagEmoji, matchDialCode } from "@/lib/phoneCountryCodes";

// A phone number field split into a country-code dropdown + local-number
// input, combined into one plain digits-only string for the caller — the
// same raw format WhatsAppButton.tsx already expects to build a wa.me
// link. Exists because a WhatsApp link only works with the full number
// including its country code, and typing "+237" (or having to remember
// it) before every number is exactly the friction this removes — the
// dropdown defaults to a sensible country (Cameroon, where Ringo
// Connect's own creator base is concentrated today) so a new field starts
// pre-filled instead of blank, but any creator can pick their own.
export default function PhoneCountryInput({
  value,
  onChange,
  onCommit,
  placeholder,
  defaultDial = "237",
}: {
  // The full number, digits only (no "+", no spaces) — same format
  // whatsapp_number is already stored in.
  value: string;
  // Fires on every keystroke/selection — for a live-preview-style
  // consumer that wants to reflect the draft immediately.
  onChange: (fullDigits: string) => void;
  // Fires once an edit is "complete" — a dial-code pick is a finished
  // edit on its own, a typed digit waits for the field to blur, matching
  // how a plain text input's onBlur already behaves for its caller.
  onCommit?: (fullDigits: string) => void;
  placeholder?: string;
  defaultDial?: string;
}) {
  const digitsOnly = (value || "").replace(/\D/g, "");
  // Only resolved once, from whatever the field already contained when it
  // mounted — after that, the dropdown is the source of truth for which
  // dial code is selected (typing more digits into the local part should
  // never silently re-guess a different country).
  const [dial, setDial] = useState<string>(() => matchDialCode(digitsOnly)?.dial ?? (digitsOnly ? "" : defaultDial));

  const local = dial && digitsOnly.startsWith(dial) ? digitsOnly.slice(dial.length) : digitsOnly;

  return (
    <div className="flex gap-2">
      <select
        aria-label="Country code"
        value={dial}
        onChange={(e) => {
          const nextDial = e.target.value;
          setDial(nextDial);
          const combined = `${nextDial}${local}`;
          onChange(combined);
          onCommit?.(combined);
        }}
        className="shrink-0 w-[100px] border border-ringo-border rounded-card px-2 py-2 text-sm bg-ringo-bg text-ringo-text"
      >
        {!dial && <option value="">—</option>}
        {PHONE_COUNTRIES.map((c) => (
          <option key={c.iso2} value={c.dial}>
            {flagEmoji(c.iso2)} +{c.dial}
          </option>
        ))}
      </select>
      <input
        value={local}
        onChange={(e) => onChange(`${dial}${e.target.value.replace(/\D/g, "")}`)}
        onBlur={(e) => onCommit?.(`${dial}${e.target.value.replace(/\D/g, "")}`)}
        placeholder={placeholder}
        inputMode="tel"
        className="flex-1 min-w-0 border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
      />
    </div>
  );
}
