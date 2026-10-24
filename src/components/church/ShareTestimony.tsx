"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Loader2, MessageSquareHeart } from "lucide-react";
import { hexToRgba } from "@/lib/color";
import type { Translations } from "@/lib/i18n/translations";
import PhoneCountryInput from "@/components/editor/PhoneCountryInput";
import { TESTIMONY_MAX } from "@/lib/church/testimonies/limits";

// "Share your testimony" on the public church page. A welcoming card with a button that opens the form IN PLACE (no modal, so it works well on a phone). The visitor needs no account.
//   * The testimony is sent privately to the church. It is public only if the church approves it AND the visitor ticks the publication box, which is UNCHECKED by default and separate from sending.
//   * The church is identified by the page's own username; the server verifies it is a published church page. Nothing here knows or shows any other submission.
//   * One form key per form prevents a double tap from creating two testimonies; the button is disabled while sending.
//   * A hidden field no person sees ("website") is a trap for bots; a real visitor never fills it.
// Everything shown is plain text from the dictionary, in the visitor's language.
type Status = "idle" | "sending" | "done";

export default function ShareTestimony({
  t,
  locale,
  username,
  accent,
  accentText,
  textColor,
  borderTint,
  radiusClass,
  initiallyOpen = false,
}: {
  t: Translations;
  locale: "en" | "fr";
  username: string;
  accent: string;
  accentText: string;
  textColor: string;
  borderTint: string;
  radiusClass: string;
  /** Only for tests and previews: draw the form already open. */
  initiallyOpen?: boolean;
}) {
  const c = t.churchTestimonies.public;
  const f = c.form;
  const [open, setOpen] = useState(initiallyOpen);
  const [status, setStatus] = useState<Status>("idle");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("237");
  const [group, setGroup] = useState("");
  const [body, setBody] = useState("");
  const [publishConsent, setPublishConsent] = useState(false);
  const [nameConsent, setNameConsent] = useState(false);
  const [trap, setTrap] = useState("");
  const [error, setError] = useState<{ code: string; field?: string } | null>(null);
  const key = useRef<string | null>(null);

  const field = `w-full min-h-[44px] rounded-xl px-3 py-2.5 text-sm placeholder:opacity-50 focus-visible:outline-none focus-visible:ring-2`;
  const fieldStyle = { border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.04), color: "inherit" } as const;
  const errorFor = (name: string) => (error && error.field === name ? f.errors[error.code] ?? f.errors.generic : null);

  const reset = () => {
    setName(""); setPhone("237"); setGroup(""); setBody(""); setPublishConsent(false); setNameConsent(false); setTrap("");
    setError(null); key.current = null; setStatus("idle");
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (status === "sending") return;
    // the key is made once per form, so sending the same form twice is one testimony
    if (!key.current) key.current = globalThis.crypto.randomUUID();
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/public/church-testimony", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ username, submission_key: key.current, full_name: name, phone, group_label: group, body, lang: locale, publish_consent: publishConsent, name_consent: publishConsent && nameConsent, website: trap }),
      });
      let json: { ok?: boolean; error?: string; field?: string } | null = null;
      try { json = await res.json(); } catch { json = null; }
      if (res.ok && json?.ok) { setStatus("done"); return; }
      setError({ code: typeof json?.error === "string" ? json.error : "generic", field: typeof json?.field === "string" ? json.field : undefined });
    } catch {
      setError({ code: "network" });
    }
    setStatus("idle");
  };

  const headingId = "church-testimony-share-heading";
  return (
    <section aria-labelledby={headingId} className={`relative overflow-hidden ${radiusClass}`} style={{ border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.03) }}>
      <div className="h-1.5 w-full" style={{ backgroundColor: accent }} aria-hidden="true" />
      <div className="p-5">
        <div className="flex items-center gap-2">
          <MessageSquareHeart size={15} className="shrink-0" style={{ color: accent }} aria-hidden="true" />
          <h2 id={headingId} className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
            {c.shareTitle}
          </h2>
        </div>

        {!open ? (
          <>
            <p className="mt-2 text-sm leading-relaxed" style={{ opacity: 0.85 }}>{c.shareIntro}</p>
            <button type="button" onClick={() => setOpen(true)} aria-expanded={false} aria-controls="church-testimony-form" className="mt-4 inline-flex min-h-[44px] items-center justify-center rounded-full px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2" style={{ backgroundColor: accent, color: "#fff" }}>
              {c.shareButton}
            </button>
          </>
        ) : status === "done" ? (
          <div id="church-testimony-form" role="status" className="mt-3 flex flex-col items-start gap-2">
            <CheckCircle2 size={24} style={{ color: accent }} aria-hidden="true" />
            <p className="text-base font-semibold">{f.successTitle}</p>
            <p className="text-sm leading-relaxed" style={{ opacity: 0.85 }}>{f.successBody}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={reset} className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2" style={{ border: `1px solid ${borderTint}`, color: accentText }}>
                {f.anotherButton}
              </button>
              <button type="button" onClick={() => { reset(); setOpen(false); }} className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2" style={{ color: accentText }}>
                {c.closeButton}
              </button>
            </div>
          </div>
        ) : (
          <form id="church-testimony-form" onSubmit={submit} noValidate className="mt-3 flex flex-col gap-4">
            <p className="text-sm leading-relaxed" style={{ opacity: 0.85 }}>{f.privacy}</p>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ct-name" className="text-sm font-semibold">{f.fullName}</label>
              <input id="ct-name" className={field} style={fieldStyle} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoComplete="name" placeholder={f.fullNamePlaceholder} required aria-invalid={!!errorFor("full_name")} aria-describedby={errorFor("full_name") ? "ct-name-err" : undefined} disabled={status === "sending"} />
              {errorFor("full_name") && <p id="ct-name-err" role="alert" className="text-xs font-medium text-red-500">{errorFor("full_name")}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ct-phone" className="text-sm font-semibold">{f.phone}</label>
              <div id="ct-phone">
                <PhoneCountryInput value={phone} onChange={setPhone} placeholder={f.phone} />
              </div>
              <p className="text-xs" style={{ opacity: 0.65 }}>{f.phoneHint}</p>
              {errorFor("phone") && <p role="alert" className="text-xs font-medium text-red-500">{errorFor("phone")}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ct-group" className="text-sm font-semibold">
                {f.group} <span className="font-normal" style={{ opacity: 0.6 }}>({f.groupOptional})</span>
              </label>
              <input id="ct-group" className={field} style={fieldStyle} value={group} onChange={(e) => setGroup(e.target.value)} maxLength={80} placeholder={f.groupPlaceholder} aria-describedby="ct-group-hint" disabled={status === "sending"} />
              <p id="ct-group-hint" className="text-xs" style={{ opacity: 0.65 }}>{f.groupHint}</p>
              {errorFor("group_label") && <p role="alert" className="text-xs font-medium text-red-500">{errorFor("group_label")}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor="ct-body" className="text-sm font-semibold">{f.testimony}</label>
              <textarea id="ct-body" className={`${field} resize-y`} style={{ ...fieldStyle, minHeight: "9rem" }} value={body} onChange={(e) => setBody(e.target.value)} maxLength={TESTIMONY_MAX} placeholder={f.testimonyPlaceholder} required aria-invalid={!!errorFor("body")} disabled={status === "sending"} />
              <span className="text-[11px]" style={{ opacity: 0.6 }}>{f.characters(body.length, TESTIMONY_MAX)}</span>
              {errorFor("body") && <p role="alert" className="text-xs font-medium text-red-500">{errorFor("body")}</p>}
            </div>

            <fieldset className="flex flex-col gap-3 rounded-xl p-3" style={{ border: `1px solid ${borderTint}` }}>
              <label className="flex min-h-[44px] items-start gap-3 text-sm">
                <input id="ct-publish" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: accent }} checked={publishConsent} onChange={(e) => { setPublishConsent(e.target.checked); if (!e.target.checked) setNameConsent(false); }} disabled={status === "sending"} />
                <span>{f.publishConsent}</span>
              </label>
              {publishConsent && (
                <label className="flex min-h-[44px] items-start gap-3 text-sm">
                  <input id="ct-name-consent" type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: accent }} checked={nameConsent} onChange={(e) => setNameConsent(e.target.checked)} disabled={status === "sending"} aria-describedby="ct-name-consent-hint" />
                  <span>
                    {f.nameConsent}
                    <span id="ct-name-consent-hint" className="mt-0.5 block text-xs" style={{ opacity: 0.65 }}>{f.nameConsentHint}</span>
                  </span>
                </label>
              )}
              <p className="text-xs" style={{ opacity: 0.65 }}>{f.consentNote}</p>
              {errorFor("publish_consent") && <p role="alert" className="text-xs font-medium text-red-500">{errorFor("publish_consent")}</p>}
            </fieldset>

            {/* a trap for bots: invisible and unreachable for people */}
            <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
              <input id="ct-website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
            </div>

            {error && !error.field && <p role="alert" className="text-sm font-medium text-red-500">{f.errors[error.code] ?? f.errors.generic}</p>}

            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={status === "sending"} className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 disabled:opacity-60" style={{ backgroundColor: accent, color: "#fff" }}>
                {status === "sending" && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
                {status === "sending" ? f.sending : f.submit}
              </button>
              <button type="button" onClick={() => setOpen(false)} disabled={status === "sending"} className="inline-flex min-h-[44px] items-center rounded-full px-4 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2" style={{ color: accentText }}>
                {c.closeButton}
              </button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
