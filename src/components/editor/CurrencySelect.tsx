"use client";

import { useEffect, useState } from "react";
import { getAllCurrencyCodes, getCurrencyLabel } from "@/lib/currency";

export default function CurrencySelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (code: string) => void;
}) {
  // Intl.DisplayNames pulls currency names from the runtime's ICU/CLDR
  // data, which can differ between Node's server-side ICU and a browser's
  // ICU (e.g. "Kyrgystani Som" vs "Kyrgyz Som" for KGS) — that mismatch
  // breaks hydration if we compute this during the render Next.js
  // compares against server HTML. Building the full list only after
  // mount, client-side only, sidesteps that entirely: SSR renders just
  // the current value as a single option (using the raw code, which is
  // identical everywhere), and the full list populates in right after.
  const [options, setOptions] = useState<{ code: string; label: string }[]>([
    { code: value, label: value },
  ]);

  useEffect(() => {
    const opts = getAllCurrencyCodes()
      .map((code) => ({ code, label: getCurrencyLabel(code) }))
      .sort((a, b) => a.code.localeCompare(b.code));
    setOptions(opts);
  }, []);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="border border-ringo-border rounded-card px-2.5 py-1.5 text-xs bg-ringo-bg text-ringo-text max-w-[130px] sm:max-w-[160px] truncate"
    >
      {options.map((o) => (
        <option key={o.code} value={o.code}>
          {o.label}
        </option>
      ))}
    </select>
  );
}