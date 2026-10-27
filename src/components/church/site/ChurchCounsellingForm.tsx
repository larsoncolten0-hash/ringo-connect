"use client";

import { useRef, useState } from "react";
import { Check, HandHeart, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import { SERIF } from "./churchTheme";

// "Talk to a pastor or counsellor" on the church page, shown only when the church owner switched counselling on. A visitor needs no account: a name, a phone number, an optional e-mail, what they would like
// to talk about, and an agreement that the church team may contact them. The request goes to /api/public/church-counselling and is readable only by the church's counselling team. Nothing the person types is
// kept in the browser (no storage, no draft), and the answer is the same whatever happened to the request. `preview` (the dashboard live preview) draws an inert card.

export default function ChurchCounsellingForm({ username, accent, accentText, textColor, borderTint, radiusClass, preview = false }: { username: string; accent: string; accentText: string; textColor: string; borderTint: string; radiusClass: string; preview?: boolean }) {
  const { t, locale } = useLanguage();
  const c = t.churchExpansion.counselling.form;
  // one key per form: tapping twice (or a retry) is one request
  const key = useRef<string>(typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [agree, setAgree] = useState(false);
  const [trap, setTrap] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/public/church-counselling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, submission_key: key.current, full_name: name, phone, email, reason, lang: locale === "fr" ? "fr" : "en", contact_consent: agree, website: trap }),
      });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        const code = typeof d?.error === "string" ? d.error : "generic";
        return setError((c.errors as Record<string, string>)[code] ?? c.errors.generic);
      }
      setDone(true);
      setName("");
      setPhone("");
      setEmail("");
      setReason("");
      setAgree(false);
    } catch {
      setError(c.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const box = `border p-5 sm:p-6 ${radiusClass}`;
  const boxStyle = { borderColor: borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6), color: textColor } as const;
  const field = "mt-1 w-full min-h-[44px] rounded-xl border bg-white/70 px-3 py-2.5 text-[0.95rem] focus-visible:outline focus-visible:outline-2";
  const fieldStyle = { borderColor: borderTint, outlineColor: accentText } as const;

  return (
    <div className={box} style={boxStyle}>
      <h3 className="flex items-center gap-2 text-[1.2rem] font-semibold leading-snug" style={{ fontFamily: SERIF }}>
        <HandHeart size={18} aria-hidden="true" style={{ color: accentText }} />
        {c.title}
      </h3>
      {preview ? (
        <p className="mt-2 text-sm leading-relaxed" style={{ opacity: 0.8 }}>
          {c.preview}
        </p>
      ) : done ? (
        <div role="status" className="mt-3">
          <p className="flex items-start gap-2 text-sm font-semibold">
            <Check size={16} className="mt-0.5 shrink-0" style={{ color: accentText }} aria-hidden="true" />
            {c.doneTitle}
          </p>
          <p className="mt-1 text-sm leading-relaxed" style={{ opacity: 0.85 }}>
            {c.doneBody}
          </p>
          <button type="button" onClick={() => { key.current = crypto.randomUUID(); setDone(false); }} className="mt-3 inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2" style={{ borderColor: borderTint, outlineColor: accentText }}>
            {c.another}
          </button>
        </div>
      ) : (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <p className="text-sm leading-relaxed" style={{ opacity: 0.85 }}>
            {c.intro}
          </p>
          <div>
            <label htmlFor="counsel-name" className="text-xs font-semibold">
              {c.name}
            </label>
            <input id="counsel-name" className={field} style={fieldStyle} value={name} maxLength={120} autoComplete="name" onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label htmlFor="counsel-phone" className="text-xs font-semibold">
              {c.phone}
            </label>
            <input id="counsel-phone" className={field} style={fieldStyle} type="tel" inputMode="tel" value={phone} maxLength={40} autoComplete="tel" onChange={(e) => setPhone(e.target.value)} aria-describedby="counsel-phone-help" required />
            <p id="counsel-phone-help" className="mt-1 text-xs" style={{ opacity: 0.75 }}>
              {c.phoneHelp}
            </p>
          </div>
          <div>
            <label htmlFor="counsel-email" className="text-xs font-semibold">
              {c.email}
            </label>
            <input id="counsel-email" className={field} style={fieldStyle} type="email" inputMode="email" value={email} maxLength={200} autoComplete="email" onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label htmlFor="counsel-reason" className="text-xs font-semibold">
              {c.reason}
            </label>
            <textarea id="counsel-reason" className={field} style={fieldStyle} rows={5} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} aria-describedby="counsel-reason-help" required />
            <p id="counsel-reason-help" className="mt-1 text-xs" style={{ opacity: 0.75 }}>
              {c.reasonHelp}
            </p>
          </div>
          {/* the honeypot: a person never sees or fills it */}
          <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
            <label htmlFor="counsel-website">{c.trap}</label>
            <input id="counsel-website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
          </div>
          <label htmlFor="counsel-consent" className="flex min-h-[44px] items-start gap-3 text-sm leading-relaxed">
            <input id="counsel-consent" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: accent }} />
            {c.consent}
          </label>
          {error && (
            <p role="alert" className="text-sm font-medium" style={{ color: "#B42318" }}>
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || !agree} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-5 text-[0.95rem] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60" style={{ backgroundColor: accent, color: "#FFFFFF", outlineColor: accentText }}>
            {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
            {busy ? c.sending : c.send}
          </button>
          <p className="text-xs leading-relaxed" style={{ opacity: 0.75 }}>
            {c.privacy}
          </p>
        </form>
      )}
    </div>
  );
}
