"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { churchErrorText } from "../lifecycle/errorText";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, ErrorLine, NoticeBar, churchApi, useNotice } from "../people/shared";

interface FeatureRow {
  bible_year: boolean;
  counselling: boolean;
  giving: boolean;
  updated_at: string | null;
}

// The church's online giving switch, at the top of the Giving page. It uses the SAME secure server flow as the feature switches (/api/church/features): the church is resolved from the session, only the owner
// can change it, the version being changed is sent with every save, and the database lock still decides whether this church may be switched on. Funds are separate: this switch never opens or publishes a fund.
// A person who is not the owner cannot read the switch (the server refuses), so they see only a short note.
export default function GivingSwitch() {
  const { t } = useLanguage();
  const a = t.churchExpansion.gifts.activation;
  const [row, setRow] = useState<FeatureRow | null>(null);
  const [available, setAvailable] = useState(false);
  const [denied, setDenied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    const r = await churchApi<{ item: FeatureRow; giving_available: boolean }>("/api/church/features");
    if (!r.ok) return setDenied(true);
    setDenied(false);
    setRow(r.body.item);
    setAvailable(r.body.giving_available === true);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const change = async () => {
    if (!row) return;
    const next = !row.giving;
    setBusy(true);
    setError("");
    const body: Record<string, unknown> = { giving: next };
    if (row.updated_at) body.expected_updated_at = row.updated_at;
    const r = await churchApi<{ item: FeatureRow }>("/api/church/features", { method: "PUT", body });
    setBusy(false);
    if (!r.ok) {
      if (r.code === "stale") await load();
      return setError(r.code === "giving_unavailable" ? a.unavailable : churchErrorText(t, r.code));
    }
    setRow(r.body.item);
    show(next ? a.savedOn : a.savedOff);
  };

  if (denied) {
    return (
      <p role="note" className="rounded-card border border-ringo-border bg-ringo-surface p-3 text-sm leading-relaxed text-ringo-muted">
        {a.ownerOnly}
      </p>
    );
  }
  if (!row) return null;
  const on = row.giving === true;
  return (
    <section aria-labelledby="church-giving-switch-title" className="rounded-card border border-ringo-border bg-ringo-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="church-giving-switch-title" className="font-display text-base font-semibold text-ringo-text">
          {a.title}
        </h2>
        <Badge tone={on ? "active" : "inactive"}>{on ? a.enabled : a.disabled}</Badge>
      </div>
      <p className="mt-2 max-w-[65ch] text-sm leading-relaxed text-ringo-muted">{on ? a.helpOn : a.helpOff}</p>
      <p className="mt-1 max-w-[65ch] text-xs leading-relaxed text-ringo-muted">{a.fundsNote}</p>
      <NoticeBar message={notice} />
      <ErrorLine message={error} />
      <div className="mt-3">
        {!available && !on ? (
          <p className="text-sm text-ringo-muted">{a.unavailable}</p>
        ) : (
          <button type="button" onClick={change} disabled={busy} className={on ? BTN_SECONDARY : BTN_PRIMARY}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {busy ? a.saving : on ? a.turnOff : a.turnOn}
          </button>
        )}
      </div>
    </section>
  );
}
