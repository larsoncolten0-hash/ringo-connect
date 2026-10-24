"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, UserRound } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import { churchErrorText } from "../lifecycle/errorText";
import PersonPicker, { type PickedPerson } from "../people/PersonPicker";
import { Badge, BTN_PRIMARY, BTN_SECONDARY, ConfirmDialog, ErrorLine, Field, INPUT, ListSkeleton, NoticeBar, churchApi, formatDay, useNotice } from "../people/shared";

interface ConsentItem {
  id: string;
  kind: "granted" | "withdrawn";
  given_by: "beneficiary" | "guardian";
  method: "written" | "verbal_witnessed";
  created_at: string;
}
interface ConsentBody {
  consent_state: "none" | "granted" | "withdrawn";
  status: string;
  items: ConsentItem[];
}

// The consent record and the private "who it is for" link of ONE care case, shown under the case editor. Both are staff-only. Consent is only ever ADDED (never edited or deleted); recording a withdrawal
// takes a public case down at once (the database does it). Nothing here involves money. The server and the database decide what is allowed; the controls only reflect it.
export default function CarePanel({ caseId, caps, dirty, onChanged }: { caseId: string; caps: ChurchCapabilities; dirty: boolean; onChanged: () => void }) {
  return (
    <div className="mt-6 flex flex-col gap-6 border-t border-ringo-border/70 pt-5">
      <ConsentSection caseId={caseId} caps={caps} dirty={dirty} onChanged={onChanged} />
      <BeneficiarySection caseId={caseId} caps={caps} />
    </div>
  );
}

function ConsentSection({ caseId, caps, dirty, onChanged }: { caseId: string; caps: ChurchCapabilities; dirty: boolean; onChanged: () => void }) {
  const { t, locale } = useLanguage();
  const c = t.churchCare.panel.consent;
  const labels = t.churchCare.consent;
  const lang = locale === "fr" ? "fr" : "en";
  const [data, setData] = useState<ConsentBody | null>(null);
  const [loadError, setLoadError] = useState("");
  const [givenBy, setGivenBy] = useState<ConsentItem["given_by"]>("beneficiary");
  const [method, setMethod] = useState<ConsentItem["method"]>("written");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    setLoadError("");
    const r = await churchApi<ConsentBody>(`/api/church/care/${caseId}/consent`);
    if (r.ok) setData(r.body);
    else setLoadError(churchErrorText(t, r.code));
  }, [caseId, t]);
  useEffect(() => {
    load();
  }, [load]);

  const record = async (kind: "granted" | "withdrawn"): Promise<string> => {
    setBusy(true);
    setError("");
    const r = await churchApi(`/api/church/care/${caseId}/consent`, { method: "POST", body: { kind, given_by: givenBy, method } });
    setBusy(false);
    if (!r.ok) {
      const msg = churchErrorText(t, r.code);
      setError(msg);
      return msg;
    }
    setConfirming(false);
    show(kind === "withdrawn" ? c.recordedWithdrawn : c.recorded);
    await load();
    onChanged();
    return "";
  };

  if (loadError)
    return (
      <section aria-labelledby="care-consent-heading" className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
        <ErrorLine message={`${c.loadError} ${loadError}`} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          {c.retry}
        </button>
      </section>
    );
  if (!data) return <ListSkeleton rows={2} />;

  const state = data.consent_state;
  const canRecord = caps.manageCare;
  return (
    <section aria-labelledby="care-consent-heading" className="flex flex-col gap-3">
      <NoticeBar message={notice} />
      <div className="flex items-center gap-2">
        <ShieldCheck size={16} className="text-ringo-indigo" aria-hidden="true" />
        <h3 id="care-consent-heading" className="font-display text-base font-semibold text-ringo-text">
          {c.heading}
        </h3>
        <Badge tone={state === "granted" ? "active" : state === "withdrawn" ? "pending" : "inactive"}>{labels.states[state]}</Badge>
      </div>
      <p className="text-sm leading-relaxed text-ringo-muted">{c.intro}</p>
      <p className="text-sm font-medium text-ringo-text" aria-live="polite">
        {c.status[state]}
      </p>

      {canRecord ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4">
          <h4 className="text-sm font-semibold text-ringo-text">{c.recordHeading}</h4>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="care-consent-by" label={c.givenBy}>
              <select id="care-consent-by" className={INPUT} value={givenBy} onChange={(e) => setGivenBy(e.target.value as ConsentItem["given_by"])} disabled={busy}>
                {(["beneficiary", "guardian"] as const).map((v) => (
                  <option key={v} value={v}>
                    {labels.givenBy[v]}
                  </option>
                ))}
              </select>
            </Field>
            <Field id="care-consent-method" label={c.method}>
              <select id="care-consent-method" className={INPUT} value={method} onChange={(e) => setMethod(e.target.value as ConsentItem["method"])} disabled={busy}>
                {(["written", "verbal_witnessed"] as const).map((v) => (
                  <option key={v} value={v}>
                    {labels.methods[v]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {dirty && <p className="text-xs text-ringo-muted">{c.saveFirst}</p>}
          <ErrorLine message={error} />
          <div>
            {state === "granted" ? (
              <button type="button" className={BTN_SECONDARY} onClick={() => setConfirming(true)} disabled={busy || dirty}>
                {busy ? c.saving : c.recordWithdrawn}
              </button>
            ) : (
              <button type="button" className={BTN_PRIMARY} onClick={() => record("granted")} disabled={busy || dirty}>
                {busy ? c.saving : c.recordGranted}
              </button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-ringo-muted">{c.viewOnly}</p>
      )}

      <div>
        <h4 className="mb-1 text-sm font-semibold text-ringo-text">{c.historyHeading}</h4>
        {data.items.length === 0 ? (
          <p className="text-sm text-ringo-muted">{c.historyEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.items.map((i) => (
              <li key={i.id} className="text-sm text-ringo-muted">
                {c.historyItem(labels.kinds[i.kind], labels.givenBy[i.given_by], labels.methods[i.method], formatDay(i.created_at, lang))}
              </li>
            ))}
          </ul>
        )}
      </div>

      {confirming && <ConfirmDialog title={c.withdrawTitle} body={c.withdrawBody} confirmLabel={c.withdrawConfirm} danger onCancel={() => setConfirming(false)} onConfirm={() => record("withdrawn")} />}
    </section>
  );
}

function BeneficiarySection({ caseId, caps }: { caseId: string; caps: ChurchCapabilities }) {
  const { t } = useLanguage();
  const c = t.churchCare.panel.beneficiary;
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [linked, setLinked] = useState<{ member_id: string; name: string | null } | null>(null);
  const [picked, setPicked] = useState<PickedPerson | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { notice, show } = useNotice();

  const load = useCallback(async () => {
    setLoadError("");
    const r = await churchApi<{ beneficiary: { member_id: string; name: string | null } | null }>(`/api/church/care/${caseId}/beneficiary`);
    if (!r.ok) {
      setLoadError(churchErrorText(t, r.code));
      return;
    }
    setLinked(r.body.beneficiary);
    setPicked(r.body.beneficiary && r.body.beneficiary.name ? { id: r.body.beneficiary.member_id, full_name: r.body.beneficiary.name } : null);
    setLoaded(true);
  }, [caseId, t]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!picked) return;
    setBusy(true);
    setError("");
    const r = await churchApi(`/api/church/care/${caseId}/beneficiary`, { method: "PUT", body: { member_id: picked.id } });
    setBusy(false);
    if (!r.ok) return setError(churchErrorText(t, r.code));
    show(c.saved);
    load();
  };
  const remove = async () => {
    setBusy(true);
    setError("");
    const r = await churchApi(`/api/church/care/${caseId}/beneficiary`, { method: "DELETE" });
    setBusy(false);
    if (!r.ok) return setError(churchErrorText(t, r.code));
    show(c.removed);
    setPicked(null);
    load();
  };

  if (loadError)
    return (
      <section aria-labelledby="care-beneficiary-heading" className="flex flex-col items-start gap-3 rounded-2xl border border-ringo-coral/30 bg-ringo-coral/[0.05] p-4">
        <ErrorLine message={`${c.loadError} ${loadError}`} />
        <button type="button" className={BTN_SECONDARY} onClick={load}>
          {t.churchCare.panel.consent.retry}
        </button>
      </section>
    );
  if (!loaded) return <ListSkeleton rows={1} />;
  const canEdit = caps.manageCare;
  return (
    <section aria-labelledby="care-beneficiary-heading" className="flex flex-col gap-3">
      <NoticeBar message={notice} />
      <div className="flex items-center gap-2">
        <UserRound size={16} className="text-ringo-indigo" aria-hidden="true" />
        <h3 id="care-beneficiary-heading" className="font-display text-base font-semibold text-ringo-text">
          {c.heading}
        </h3>
      </div>
      <p className="text-sm leading-relaxed text-ringo-muted">{c.intro}</p>
      {!linked && <p className="text-sm text-ringo-muted">{c.none}</p>}
      {linked && !linked.name && <p className="text-sm text-ringo-muted">{c.nameHidden}</p>}
      {canEdit ? (
        <>
          <PersonPicker label={c.label} placeholder={c.placeholder} noneText={c.noneText} clearLabel={c.clear} value={picked} onChange={setPicked} ageGroup="adult" disabled={busy} />
          <ErrorLine message={error} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BTN_PRIMARY} onClick={save} disabled={busy || !picked || picked.id === linked?.member_id}>
              {busy ? c.saving : c.save}
            </button>
            {linked && (
              <button type="button" className={BTN_SECONDARY} onClick={remove} disabled={busy}>
                {c.clear}
              </button>
            )}
          </div>
        </>
      ) : (
        linked && linked.name && <p className="text-sm font-medium text-ringo-text">{linked.name}</p>
      )}
      {!canEdit && <p className="text-xs text-ringo-muted">{c.viewOnly}</p>}
    </section>
  );
}
