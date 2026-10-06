"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { AMBASSADOR_CODE_MAX_LENGTH, isValidAmbassadorCodeFormat, normalizeAmbassadorCode } from "@/lib/ambassadorCode";

// Lets an Ambassador (or a Team Leader with their own Ambassador profile) replace
// their auto-generated code with one they choose — same interaction as the
// affiliate code editor. POST /api/ambassador/code is the only thing that can write
// it; a "taken" answer is shown inline next to the input. The person is warned,
// before saving, that the old code stops working.
export default function AmbassadorCodeEditor({ code }: { code: string }) {
  const { t } = useLanguage();
  const c = t.ambassadorCode;
  const errors = c.errors as Record<string, string>;
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(code);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const start = () => {
    setValue(code);
    setError("");
    setEditing(true);
  };
  const cancel = () => {
    setEditing(false);
    setError("");
    setValue(code);
  };

  const save = async () => {
    const normalized = normalizeAmbassadorCode(value);
    if (!isValidAmbassadorCodeFormat(normalized)) {
      setError(errors.invalid_code);
      return;
    }
    if (normalized === code) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/ambassador/code", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: normalized }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.ok) {
        setError(errors[json.code] || errors.unavailable);
        return;
      }
      setEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      router.refresh(); // the link below is rebuilt from the new code
    } catch {
      setError(errors.network);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="flex flex-col gap-0.5">
        <p className="text-xs text-ringo-muted">{c.label}</p>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-mono font-semibold text-ringo-text tracking-wide">{code}</span>
          <button type="button" onClick={start} className="ringo-tactile inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-ringo-border px-4 text-xs font-semibold text-ringo-indigo hover:border-ringo-indigo/40 hover:bg-ringo-indigo/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">
            {c.edit}
          </button>
          {saved && (
            <span className="text-xs text-emerald-600 flex items-center gap-1">
              <Check size={11} /> {c.saved}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-ringo-muted">{c.label}</p>
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value.toUpperCase().slice(0, AMBASSADOR_CODE_MAX_LENGTH))}
          maxLength={AMBASSADOR_CODE_MAX_LENGTH}
          autoFocus
          autoComplete="off"
          className="w-40 rounded-lg border border-ringo-border/60 bg-ringo-bg px-2.5 py-1.5 text-sm font-mono tracking-wide text-ringo-text outline-none focus:ring-2 focus:ring-ringo-indigo/40"
        />
        <button type="button" onClick={save} disabled={saving} className="flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg bg-ringo-indigo text-white disabled:opacity-60">
          {saving && <Loader2 size={12} className="animate-spin" />}
          {c.save}
        </button>
        <button type="button" onClick={cancel} disabled={saving} className="text-xs text-ringo-muted hover:text-ringo-text disabled:opacity-60">
          {c.cancel}
        </button>
      </div>
      {error ? (
        <p className="text-xs text-red-500 flex items-center gap-1.5">
          <AlertTriangle size={12} /> {error}
        </p>
      ) : (
        <p className="text-xs text-ringo-muted">{c.hint}</p>
      )}
      <p className="text-xs text-amber-600">{c.changeWarning}</p>
    </div>
  );
}
