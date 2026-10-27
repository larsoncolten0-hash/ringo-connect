"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, UserCheck } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import { SERIF } from "./churchTheme";

// "Become a member" on a church's public page. A visitor who has CONNECTED to the church may ask to join as an adult or a young person (a child is never self-registered: church staff add a child under a
// guardian). The request waits for the church team to approve it. Joining is an explicit choice with an explicit agreement, because who belongs to a church is private information. The state comes from the
// visitor's own session (never from this page), so it survives refreshes and new tabs; a visitor who is not connected yet is told to connect first (the Connect button sits right beside this card).
// `preview` (the dashboard live preview) draws an inert card: no request is made.

type State = "loading" | "needConnect" | "none" | "pending" | "active";

export default function ChurchMembershipJoin({ profile, accent, accentText, textColor, borderTint, radiusClass, preview = false }: { profile: { id: string; name: string }; accent: string; accentText: string; textColor: string; borderTint: string; radiusClass: string; preview?: boolean }) {
  const { t } = useLanguage();
  const c = t.churchExpansion.members.join;
  const [state, setState] = useState<State>(preview ? "none" : "loading");
  const [age, setAge] = useState<"adult" | "youth">("adult");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/customer/church-membership?profile_id=${encodeURIComponent(profile.id)}`, { cache: "no-store" });
      if (!res.ok) return setState("needConnect");
      const d = await res.json();
      if (d?.connected !== true) return setState("needConnect");
      setState(d.status === "pending" ? "pending" : d.status === "active" ? "active" : "none");
    } catch {
      setState("needConnect");
    }
  }, [profile.id]);

  useEffect(() => {
    if (preview) return;
    load();
    const onVisible = () => document.visibilityState === "visible" && load();
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    // a visitor who connects with the button beside this card should see the form without reloading
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (tries > 20) window.clearInterval(timer);
      else load();
    }, 6000);
    return () => {
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
      window.clearInterval(timer);
    };
  }, [preview, load]);

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/customer/church-membership", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile_id: profile.id, age_group: age, consent: agree }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        const code = typeof d?.error === "string" ? d.error : "generic";
        setError((c.errors as Record<string, string>)[code] ?? c.errors.generic);
        if (code === "church_request_not_connected" || code === "not_signed_in") setState("needConnect");
        return;
      }
      setState(d?.status === "active" ? "active" : "pending");
    } catch {
      setError(c.errors.generic);
    } finally {
      setBusy(false);
    }
  };

  const box = `border p-5 ${radiusClass}`;
  const boxStyle = { borderColor: borderTint, backgroundColor: hexToRgba("#FFFFFF", 0.6), color: textColor } as const;
  const head = (
    <h3 className="flex items-center gap-2 text-[1.2rem] font-semibold leading-snug" style={{ fontFamily: SERIF }}>
      <UserCheck size={18} aria-hidden="true" style={{ color: accentText }} />
      {c.title}
    </h3>
  );
  if (state === "loading") return null;

  if (state === "pending" || state === "active") {
    return (
      <div className={box} style={boxStyle} role="status">
        {head}
        <p className="mt-2 flex items-start gap-2 text-sm font-semibold">
          <Check size={16} className="mt-0.5 shrink-0" aria-hidden="true" style={{ color: accentText }} />
          {state === "pending" ? c.pendingTitle : c.activeTitle}
        </p>
        <p className="mt-1 text-sm leading-relaxed" style={{ opacity: 0.8 }}>
          {state === "pending" ? c.pendingBody : c.activeBody}
        </p>
      </div>
    );
  }

  return (
    <div className={box} style={boxStyle}>
      {head}
      <p className="mt-2 text-sm leading-relaxed" style={{ opacity: 0.8 }}>
        {preview ? c.preview : state === "needConnect" ? c.needConnect : c.intro}
      </p>
      {!preview && state === "none" && (
        <form
          className="mt-4 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="text-xs font-semibold">{c.ageLabel}</legend>
            {(["adult", "youth"] as const).map((v) => (
              <label key={v} htmlFor={`membership-age-${v}`} className="flex min-h-[44px] items-center gap-3 text-sm">
                <input id={`membership-age-${v}`} type="radio" name={`membership-age-${profile.id}`} value={v} checked={age === v} onChange={() => setAge(v)} className="h-5 w-5" style={{ accentColor: accent }} />
                {c[v]}
              </label>
            ))}
          </fieldset>
          <label htmlFor="membership-consent" className="flex min-h-[44px] items-start gap-3 text-sm leading-relaxed">
            <input id="membership-consent" type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0" style={{ accentColor: accent }} />
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
        </form>
      )}
    </div>
  );
}
