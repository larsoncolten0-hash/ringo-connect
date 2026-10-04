"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { callInboxTool, settingsUrl } from "@/lib/inbox/client";
import { ACK_MAX, DAYS, toSavePayload, validateSettings, type AckMode, type Day, type InboxSettings, type SettingsErrorKey } from "@/lib/inbox/settings";

// The owner's inbox automation settings. Everything is OFF until switched on. Saving is ONE call to our own route (the profile comes from the
// session, never from here); the database validates again. Nothing on this page sends a message.

const DEFAULT_INTERVAL: [string, string] = ["09:00", "18:00"];

export default function InboxSettingsForm({ initial, available }: { initial: InboxSettings; available: boolean }) {
  const { t, locale } = useLanguage();
  const s = t.inbox.settings;
  const router = useRouter();
  const [draft, setDraft] = useState<InboxSettings>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<SettingsErrorKey | null>(null);
  const [savedOnce, setSavedOnce] = useState(false);
  const inFlight = useRef(false);
  const set = (patch: Partial<InboxSettings>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setSavedOnce(false);
  };

  function setDay(day: Day, open: boolean) {
    const hours = { ...draft.businessHours };
    if (open) hours[day] = hours[day]?.length ? hours[day] : [[...DEFAULT_INTERVAL]];
    else delete hours[day];
    set({ businessHours: hours });
  }
  function setTime(day: Day, which: 0 | 1, value: string) {
    const list = (draft.businessHours[day] ?? [[...DEFAULT_INTERVAL]]).map((i) => [...i] as [string, string]);
    list[0][which] = value;
    set({ businessHours: { ...draft.businessHours, [day]: list } });
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (inFlight.current) return;
    const problem = validateSettings(draft);
    if (problem) return setError(problem);
    inFlight.current = true;
    setBusy(true);
    setError(null);
    const r = await callInboxTool("POST", settingsUrl, toSavePayload(draft));
    inFlight.current = false;
    setBusy(false);
    if (r.kind === "response" && r.body.ok) {
      setSavedOnce(true);
      router.refresh();
    } else setError("saveFailed");
  }

  const label = "block text-xs font-medium text-ringo-text";
  const field = "mt-1 block w-full rounded-card border border-ringo-border bg-transparent px-3 py-2 text-sm text-ringo-text focus:border-ringo-indigo focus:outline-none";
  const card = "rounded-card border border-ringo-border p-4";
  const check = (id: string, text: string, value: boolean, on: (v: boolean) => void) => (
    <label htmlFor={id} className="flex min-h-[40px] items-center gap-2.5 text-sm text-ringo-text">
      <input id={id} type="checkbox" checked={value} onChange={(e) => on(e.target.checked)} className="h-4 w-4 accent-ringo-indigo" />
      {text}
    </label>
  );

  return (
    <form onSubmit={save} className="flex max-w-2xl flex-col gap-4" data-testid="inbox-settings">
      <div>
        <Link href="/dashboard/inbox" className="mb-2 inline-flex items-center gap-1 text-xs text-ringo-muted hover:text-ringo-text">
          <ArrowLeft size={14} aria-hidden="true" />
          {s.back}
        </Link>
        <h1 className="font-display text-xl font-medium text-ringo-text">{s.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{s.intro}</p>
      </div>

      {!available && <p role="status" className="rounded-card border border-ringo-border p-3 text-sm text-ringo-muted">{s.unavailable}</p>}

      <fieldset disabled={!available || busy} className="flex flex-col gap-4 disabled:opacity-70">
        <section className={card} aria-labelledby="hours-h">
          <h2 id="hours-h" className="text-sm font-semibold text-ringo-text">{s.hoursTitle}</h2>
          <p className="mt-1 text-xs text-ringo-muted">{s.hoursHelp}</p>
          <label htmlFor="tz" className={`${label} mt-3`}>{s.timezone}</label>
          <input id="tz" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} maxLength={64} autoComplete="off" spellCheck={false} className={field} aria-describedby="tz-help" />
          <p id="tz-help" className="mt-1 text-[11px] text-ringo-muted">{s.timezoneHelp}</p>
          <ul className="mt-3 flex flex-col gap-1">
            {DAYS.map((day) => {
              const interval = draft.businessHours[day]?.[0];
              return (
                <li key={day} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="w-28">{check(`day-${day}`, s.days[day], !!interval, (v) => setDay(day, v))}</span>
                  {interval && (
                    <span className="flex items-center gap-2 text-xs text-ringo-muted">
                      <label htmlFor={`from-${day}`}>{s.from}</label>
                      <input id={`from-${day}`} type="time" value={interval[0]} onChange={(e) => setTime(day, 0, e.target.value)} className="rounded-card border border-ringo-border bg-transparent px-2 py-1 text-sm text-ringo-text" />
                      <label htmlFor={`to-${day}`}>{s.to}</label>
                      <input id={`to-${day}`} type="time" value={interval[1]} onChange={(e) => setTime(day, 1, e.target.value)} className="rounded-card border border-ringo-border bg-transparent px-2 py-1 text-sm text-ringo-text" />
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section className={card} aria-labelledby="ack-h">
          <h2 id="ack-h" className="text-sm font-semibold text-ringo-text">{s.ackTitle}</h2>
          <p className="mt-1 text-xs text-ringo-muted">{s.ackHelp}</p>
          <label htmlFor="ack-mode" className={`${label} mt-3`}>{s.ackMode}</label>
          <select id="ack-mode" value={draft.autoAckMode} onChange={(e) => set({ autoAckMode: e.target.value as AckMode })} className={field}>
            <option value="off">{s.ackOff}</option>
            <option value="outside_hours">{s.ackOutside}</option>
            <option value="always">{s.ackAlways}</option>
          </select>
          <label htmlFor="ack-text" className={`${label} mt-3`}>{s.ackText}</label>
          <textarea id="ack-text" value={draft.autoAckText} onChange={(e) => set({ autoAckText: e.target.value })} maxLength={ACK_MAX} rows={3} placeholder={s.ackTextPlaceholder} className={`${field} resize-y`} />
          <button type="button" onClick={() => set({ autoAckText: s.ackSuggested })} className="mt-2 text-xs text-ringo-indigo hover:underline">{s.ackSuggest}</button>
        </section>

        <section className={card} aria-labelledby="fu-h">
          <h2 id="fu-h" className="text-sm font-semibold text-ringo-text">{s.followTitle}</h2>
          <p className="mt-1 text-xs text-ringo-muted">{s.followHelp}</p>
          <div className="mt-2">{check("fu-on", s.followEnabled, draft.followUpEnabled, (v) => set({ followUpEnabled: v }))}</div>
          <label htmlFor="fu-hours" className={`${label} mt-2`}>{s.followAfter}</label>
          <input id="fu-hours" type="number" inputMode="numeric" min={1} max={168} step={1} value={draft.followUpAfterHours} onChange={(e) => set({ followUpAfterHours: Number(e.target.value) })} className={`${field} max-w-[8rem]`} />
        </section>

        <section className={card} aria-labelledby="nt-h">
          <h2 id="nt-h" className="text-sm font-semibold text-ringo-text">{s.notifyTitle}</h2>
          <div className="mt-2 flex flex-col">
            {check("nt-new", s.notifyNew, draft.notifyNewConversation, (v) => set({ notifyNewConversation: v }))}
            {check("nt-failed", s.notifyFailed, draft.notifyFailedMessage, (v) => set({ notifyFailedMessage: v }))}
            {check("nt-follow", s.notifyFollow, draft.notifyFollowUp, (v) => set({ notifyFollowUp: v }))}
          </div>
          <label htmlFor="nt-locale" className={`${label} mt-2`}>{s.notifyLocale}</label>
          <select id="nt-locale" value={draft.notificationLocale} onChange={(e) => set({ notificationLocale: e.target.value === "en" ? "en" : "fr" })} className={`${field} max-w-[12rem]`}>
            <option value="en">{s.english}</option>
            <option value="fr">{s.french}</option>
          </select>
        </section>
      </fieldset>

      <div aria-live="polite" className="min-h-[1.25rem] text-sm">
        {error && <p role="alert" className="text-red-600 dark:text-red-400">{s.errors[error]}</p>}
        {savedOnce && !error && <p role="status" className="text-emerald-700 dark:text-emerald-400">{s.saved}</p>}
      </div>
      <div>
        <button type="submit" disabled={!available || busy} data-locale={locale} className="inline-flex min-h-[44px] items-center rounded-full bg-ringo-indigo px-5 text-sm font-medium text-white disabled:opacity-60">
          {busy ? s.saving : s.save}
        </button>
      </div>
    </form>
  );
}
