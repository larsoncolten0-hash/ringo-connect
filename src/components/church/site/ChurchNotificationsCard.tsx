"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Check, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import { getPushStatus, subscribeToPush } from "@/lib/push/subscribeClient";
import { PUSH_TOPICS, type PushTopic } from "@/lib/church/push/topics";
import { SERIF } from "./churchTheme";

// Notifications from a church, chosen by a CONNECTED visitor: which topics (new announcement, event, testimony, Daily Word, the daily Bible reading, care needs, the store, the visitor's own groups) and
// whether this device receives them. Everything is off until the visitor turns it on; the choice is the visitor's own (their session, never this page) and the church never sees it. The device is registered
// by the existing customer push route; nothing here asks for the browser's permission except from a click. `preview` (the dashboard live preview) draws an inert card.

type DeviceState = "checking" | "on" | "off" | "denied" | "unsupported" | "ios-needs-install" | "busy" | "failed";
interface Prefs {
  connected: boolean;
  topics: PushTopic[];
  available: PushTopic[];
  devices: number;
}

export default function ChurchNotificationsCard({ profile, accent, accentText, textColor, borderTint, radiusClass, preview = false }: { profile: { id: string; name: string }; accent: string; accentText: string; textColor: string; borderTint: string; radiusClass: string; preview?: boolean }) {
  const { t } = useLanguage();
  const c = t.churchExpansion.push.card;
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [chosen, setChosen] = useState<PushTopic[]>([]);
  const [device, setDevice] = useState<DeviceState>("checking");
  const [state, setState] = useState<"loading" | "needConnect" | "ready" | "error">(preview ? "ready" : "loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/customer/church-push?profile_id=${encodeURIComponent(profile.id)}`, { cache: "no-store" });
      if (res.status === 401) return setState("needConnect");
      const d = await res.json().catch(() => null);
      if (!res.ok || !d) return setState("error");
      if (d.connected !== true) return setState("needConnect");
      setPrefs(d as Prefs);
      setChosen((d as Prefs).topics);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [profile.id]);

  const refreshDevice = useCallback(async () => {
    const s = await getPushStatus();
    if (!s.supported) return setDevice(/iphone|ipad|ipod/i.test(navigator.userAgent) ? "ios-needs-install" : "unsupported");
    if (s.permission === "denied") return setDevice("denied");
    setDevice(s.permission === "granted" && s.subscribed ? "on" : "off");
  }, []);

  useEffect(() => {
    if (preview) return;
    load();
    refreshDevice();
    // a visitor who connects with the button beside this card should see the choices without reloading
    let tries = 0;
    const timer = window.setInterval(() => {
      tries += 1;
      if (tries > 20) window.clearInterval(timer);
      else load();
    }, 6000);
    return () => window.clearInterval(timer);
  }, [preview, load, refreshDevice]);

  const enableDevice = async () => {
    if (device === "busy") return;
    // the first await of the click handler: iOS drops permission requests otherwise
    const pending = subscribeToPush({ subscribeUrl: "/api/customer/push/subscribe" });
    setDevice("busy");
    const result = await pending;
    setDevice(result.ok ? "on" : result.error === "permission_denied" ? "denied" : "failed");
  };

  const save = async (topics: PushTopic[]) => {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const res = await fetch("/api/customer/church-push", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ profile_id: profile.id, topics }) });
      const d = await res.json().catch(() => null);
      if (!res.ok) {
        const code = typeof d?.error === "string" ? d.error : "generic";
        setError((c.errors as Record<string, string>)[code] ?? c.errors.generic);
        if (code === "church_push_not_connected" || code === "not_signed_in") setState("needConnect");
        return;
      }
      setChosen(topics);
      setMessage(topics.length === 0 ? c.stopped : c.saved);
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
      <Bell size={18} aria-hidden="true" style={{ color: accentText }} />
      {c.title}
    </h3>
  );
  if (state === "loading") return null;
  if (state === "error") {
    return (
      <div className={box} style={boxStyle}>
        {head}
        <p className="mt-2 text-sm">{c.loadError}</p>
        <button type="button" onClick={load} className="mt-3 inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-semibold" style={{ borderColor: borderTint }}>
          {c.retry}
        </button>
      </div>
    );
  }
  if (preview || state === "needConnect") {
    return (
      <div className={box} style={boxStyle}>
        {head}
        <p className="mt-2 text-sm leading-relaxed" style={{ opacity: 0.8 }}>
          {preview ? c.preview : c.needConnect}
        </p>
      </div>
    );
  }

  const available = prefs?.available ?? PUSH_TOPICS;
  const dirty = JSON.stringify([...chosen].sort()) !== JSON.stringify([...(prefs?.topics ?? [])].sort());
  const deviceNote: Record<DeviceState, string | null> = { checking: null, busy: null, on: c.deviceOn, off: c.deviceOff, denied: c.denied, unsupported: c.unsupported, "ios-needs-install": c.iosInstall, failed: c.failed };
  return (
    <div className={box} style={boxStyle}>
      {head}
      <p className="mt-2 text-sm leading-relaxed" style={{ opacity: 0.8 }}>
        {c.intro}
      </p>
      <fieldset className="mt-4 flex flex-col">
        <legend className="sr-only">{c.title}</legend>
        {available.map((topic, i) => {
          const info = c.topics[topic];
          const on = chosen.includes(topic);
          return (
            <label key={topic} htmlFor={`church-push-${topic}`} className="flex min-h-[48px] items-start gap-3 py-2 text-sm" style={i > 0 ? { borderTop: `1px solid ${borderTint}` } : undefined}>
              <input
                id={`church-push-${topic}`}
                type="checkbox"
                checked={on}
                onChange={() => setChosen((cur) => (cur.includes(topic) ? cur.filter((x) => x !== topic) : [...cur, topic]))}
                className="mt-0.5 h-5 w-5 shrink-0"
                style={{ accentColor: accent }}
              />
              <span>
                <span className="block font-semibold">{info.label}</span>
                <span className="block text-xs leading-relaxed" style={{ opacity: 0.75 }}>
                  {info.help}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => save(chosen)} disabled={busy || !dirty} className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full px-5 text-[0.95rem] font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-60" style={{ backgroundColor: accent, color: "#FFFFFF", outlineColor: accentText }}>
          {busy && <Loader2 size={16} className="animate-spin" aria-hidden="true" />}
          {busy ? c.saving : c.save}
        </button>
        {(prefs?.topics.length ?? 0) > 0 && (
          <button type="button" onClick={() => save([])} disabled={busy} className="inline-flex min-h-[48px] items-center gap-2 rounded-full border px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2" style={{ borderColor: borderTint, outlineColor: accentText }}>
            <BellOff size={15} aria-hidden="true" />
            {c.stopAll}
          </button>
        )}
      </div>
      <div role="status" aria-live="polite" className="min-h-[1.25rem]">
        {message && (
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium" style={{ color: accentText }}>
            <Check size={15} aria-hidden="true" />
            {message}
          </p>
        )}
        {error && (
          <p role="alert" className="mt-2 text-sm font-medium" style={{ color: "#B42318" }}>
            {error}
          </p>
        )}
      </div>

      <div className="mt-4 border-t pt-4" style={{ borderColor: borderTint }}>
        <p className="text-xs font-semibold">{c.deviceTitle}</p>
        {deviceNote[device] && (
          <p className="mt-1 text-sm" style={{ opacity: 0.85 }}>
            {deviceNote[device]}
          </p>
        )}
        {(device === "off" || device === "failed" || device === "busy") && (
          <button type="button" onClick={enableDevice} disabled={device === "busy"} className="mt-2 inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2" style={{ borderColor: borderTint, outlineColor: accentText }}>
            {device === "busy" ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : <Bell size={15} aria-hidden="true" />}
            {device === "busy" ? c.enabling : c.enableDevice}
          </button>
        )}
      </div>
      <p className="mt-4 text-xs leading-relaxed" style={{ opacity: 0.75 }}>
        {c.privacy}
      </p>
    </div>
  );
}
