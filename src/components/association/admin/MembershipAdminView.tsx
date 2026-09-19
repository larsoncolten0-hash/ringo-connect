"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import SectionTabs from "@/components/dashboard/SectionTabs";
import { Loader2, ArrowLeft } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import ManagedMemberPanel, { MembershipBadge } from "./ManagedMemberPanel";
import type { AssociationPerms, AuditRow, PlanRow, RosterMember } from "@/lib/association/membershipTypes";

type Tab = "members" | "plans" | "settings" | "audit";

const inputClass = "w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg";

export default function MembershipAdminView({
  associationId,
  associationName,
  perms,
  initialEnabled,
  initialPrefix,
}: {
  associationId: string;
  associationName: string;
  perms: AssociationPerms;
  initialEnabled: boolean;
  initialPrefix: string;
}) {
  const { t, locale } = useLanguage();
  const a = t.association;
  const m = a.membership;
  const base = `/api/associations/${associationId}`;
  const canSeeMembers = perms.membershipsView || perms.membershipsManage;
  const [tab, setTab] = useState<Tab>(canSeeMembers ? "members" : "plans");
  const [enabled, setEnabled] = useState(initialEnabled);
  const [prefix, setPrefix] = useState(initialPrefix);
  const err = (code?: string) => (code && m.errors[code]) || a.genericError;

  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: "members", label: m.tabMembers, show: canSeeMembers },
    { id: "plans", label: m.tabPlans, show: true },
    { id: "settings", label: m.tabSettings, show: perms.settings },
    { id: "audit", label: m.tabAudit, show: perms.audit },
  ];

  return (
    <div className="max-w-3xl flex flex-col gap-5">
      <div>
        <Link href="/dashboard/association" className="inline-flex items-center gap-1 text-xs text-ringo-muted hover:text-ringo-text mb-2">
          <ArrowLeft size={12} /> {a.dashboardTitle}
        </Link>
        <h1 className="font-display text-lg font-semibold text-ringo-text">{m.pageTitle}</h1>
        <p className="text-sm text-ringo-muted mt-0.5">
          {associationName} · {m.pageSubtitle}
        </p>
      </div>

      <SectionTabs
        tabs={tabs.filter((x) => x.show).map((x) => ({ label: x.label, active: tab === x.id, onSelect: () => setTab(x.id) }))}
      />

      {!enabled && tab !== "settings" && <p className="text-sm text-ringo-muted rounded-2xl border border-dashed border-ringo-border p-4">{m.errors.membership_not_enabled}</p>}

      {tab === "members" && canSeeMembers && <MembersTab base={base} associationId={associationId} canManage={perms.membershipsManage} enabled={enabled} locale={locale} m={m} a={a} />}
      {tab === "plans" && <PlansTab base={base} canManage={perms.plans} enabled={enabled} locale={locale} m={m} a={a} err={err} />}
      {tab === "settings" && perms.settings && (
        <SettingsTab base={base} enabled={enabled} prefix={prefix} onSaved={(e, p) => { setEnabled(e); setPrefix(p); }} m={m} a={a} err={err} />
      )}
      {tab === "audit" && perms.audit && <AuditTab base={base} locale={locale} m={m} />}
    </div>
  );
}

function Loading() {
  return <Loader2 size={18} className="animate-spin text-ringo-muted" />;
}

/* -------------------------------- members -------------------------------- */
function MembersTab({ base, associationId, canManage, enabled, locale, m, a }: { base: string; associationId: string; canManage: boolean; enabled: boolean; locale: string; m: any; a: any }) {
  const [members, setMembers] = useState<RosterMember[] | null>(null);
  const [open, setOpen] = useState<RosterMember | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`${base}/members`);
    setMembers(res.ok ? (await res.json()).members || [] : []);
  }, [base]);
  useEffect(() => {
    load();
  }, [load]);

  const expire = async () => {
    setBusy(true);
    setNote("");
    try {
      const res = await fetch(`${base}/memberships/expire`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      setNote(res.ok ? m.expireDone(d.expired ?? 0) : m.errors[d.code] || a.genericError);
      if (res.ok) load();
    } finally {
      setBusy(false);
    }
  };

  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }) : m.noExpiry);

  return (
    <div className="flex flex-col gap-3">
      {canManage && (
        <div className="flex flex-col items-end gap-1">
          <button onClick={expire} disabled={busy} className="px-3.5 py-2 rounded-full text-xs font-medium border border-ringo-border text-ringo-text hover:border-ringo-indigo disabled:opacity-60">
            {m.expireCta}
          </button>
          <p className="text-[11px] text-ringo-muted text-right max-w-xs">{m.expireHint}</p>
          {note && <p className="text-xs text-ringo-text">{note}</p>}
        </div>
      )}
      {members === null ? (
        <Loading />
      ) : members.length === 0 ? (
        <p className="text-sm text-ringo-muted">{m.rosterEmpty}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {members.map((mem) => (
            <div key={mem.id} className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ringo-text truncate">{mem.name}</p>
                <p className="text-xs text-ringo-muted truncate">
                  {mem.membership ? `${mem.membership.membershipNumber} · ${m.expiresLabel}: ${fmt(mem.membership.expiresAt)}` : m.notEnrolled}
                </p>
              </div>
              {mem.membership && <MembershipBadge state={mem.membership.effectiveState} />}
              {(canManage || mem.membership) && (
                <button
                  onClick={() => setOpen(mem)}
                  disabled={!mem.membership && (!canManage || !enabled)}
                  className="px-3 py-1.5 rounded-full text-xs font-medium border border-ringo-border text-ringo-text hover:border-ringo-indigo disabled:opacity-40"
                >
                  {mem.membership ? m.membershipButton : m.actionEnroll}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      {open && (
        <ManagedMemberPanel
          associationId={associationId}
          memberId={open.id}
          memberName={open.name}
          info={open.membership}
          canManage={canManage}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

/* --------------------------------- plans --------------------------------- */
interface PlanForm {
  id?: string;
  nameEn: string;
  nameFr: string;
  descriptionEn: string;
  descriptionFr: string;
  priceAmount: string;
  currency: string;
  durationMonths: string;
  graceDays: string;
}
const emptyPlan: PlanForm = { nameEn: "", nameFr: "", descriptionEn: "", descriptionFr: "", priceAmount: "0", currency: "XAF", durationMonths: "12", graceDays: "0" };

function PlansTab({ base, canManage, enabled, locale, m, a, err }: { base: string; canManage: boolean; enabled: boolean; locale: string; m: any; a: any; err: (c?: string) => string }) {
  const [plans, setPlans] = useState<PlanRow[] | null>(null);
  const [form, setForm] = useState<PlanForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const res = await fetch(`${base}/membership-plans`);
    setPlans(res.ok ? (await res.json()).plans || [] : []);
  }, [base]);
  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!form) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(form.id ? `${base}/membership-plans/${form.id}` : `${base}/membership-plans`, {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nameEn: form.nameEn, nameFr: form.nameFr, descriptionEn: form.descriptionEn, descriptionFr: form.descriptionFr,
          priceAmount: Number(form.priceAmount), currency: form.currency,
          durationMonths: form.durationMonths === "" ? null : Number(form.durationMonths), graceDays: Number(form.graceDays || 0),
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) return setError(err(d.code));
      setForm(null);
      load();
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (p: PlanRow, active: boolean) => {
    const res = await fetch(`${base}/membership-plans/${p.id}/active`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active }) });
    if (!res.ok) setError(err((await res.json().catch(() => ({}))).code));
    else load();
  };

  const field = (label: string, key: keyof PlanForm, type = "text", hint?: string) => (
    <label className="flex flex-col gap-1 text-xs text-ringo-muted">
      {label}
      <input type={type} value={form![key] as string} onChange={(e) => setForm({ ...form!, [key]: e.target.value })} className={inputClass} />
      {hint && <span className="text-[11px]">{hint}</span>}
    </label>
  );

  return (
    <div className="flex flex-col gap-3">
      {canManage && enabled && !form && (
        <div className="flex justify-end">
          <button onClick={() => { setError(""); setForm({ ...emptyPlan }); }} className="px-4 py-2.5 rounded-full text-sm font-semibold bg-ringo-indigo text-white">
            {m.newPlanCta}
          </button>
        </div>
      )}
      {form && (
        <div className="rounded-2xl border border-ringo-border/70 p-4 flex flex-col gap-3">
          <p className="text-xs text-ringo-muted">{m.bothLanguagesNote}</p>
          {field(m.planNameEnLabel, "nameEn")}
          {field(m.planNameFrLabel, "nameFr")}
          {field(m.planDescEnLabel, "descriptionEn")}
          {field(m.planDescFrLabel, "descriptionFr")}
          <div className="grid grid-cols-2 gap-3">
            {field(m.priceLabel, "priceAmount", "number")}
            {field(m.currencyLabel, "currency")}
            {field(m.durationLabel, "durationMonths", "number", m.durationHint)}
            {field(m.graceLabel, "graceDays", "number")}
          </div>
          <p className="text-[11px] text-ringo-muted">{m.priceNote}</p>
          {error && <p className="text-xs text-ringo-coral">{error}</p>}
          <div className="flex gap-2 justify-end">
            <button onClick={() => setForm(null)} disabled={busy} className="px-4 py-2 rounded-full text-sm text-ringo-muted hover:bg-ringo-muted/10">{a.cancelAction}</button>
            <button onClick={save} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-ringo-indigo text-white disabled:opacity-60">
              {busy && <Loader2 size={14} className="animate-spin" />} {m.savePlanCta}
            </button>
          </div>
        </div>
      )}
      {!form && error && <p className="text-xs text-ringo-coral">{error}</p>}
      {plans === null ? (
        <Loading />
      ) : plans.length === 0 ? (
        <p className="text-sm text-ringo-muted">{m.noPlansYet}</p>
      ) : (
        <div className="flex flex-col gap-2.5">
          {plans.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-ringo-text truncate">{locale === "fr" ? p.name_fr : p.name_en}</p>
                <p className="text-xs text-ringo-muted">
                  {formatPrice(p.price_amount, p.currency, locale)} · {p.duration_months ? m.planMonths(p.duration_months) : m.lifetime}
                  {p.grace_days > 0 ? ` · ${m.graceDays(p.grace_days)}` : ""}
                </p>
              </div>
              {!p.active && <span className="text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full bg-ringo-muted/10 text-ringo-muted">{m.archivedBadge}</span>}
              {canManage && (
                <>
                  <button
                    onClick={() => { setError(""); setForm({ id: p.id, nameEn: p.name_en, nameFr: p.name_fr, descriptionEn: p.description_en || "", descriptionFr: p.description_fr || "", priceAmount: String(p.price_amount), currency: p.currency, durationMonths: p.duration_months === null ? "" : String(p.duration_months), graceDays: String(p.grace_days) }); }}
                    disabled={!enabled}
                    className="px-3 py-1.5 rounded-full text-xs font-medium border border-ringo-border text-ringo-text hover:border-ringo-indigo disabled:opacity-40"
                  >
                    {m.editPlanCta}
                  </button>
                  <button onClick={() => setActive(p, !p.active)} className="px-3 py-1.5 rounded-full text-xs font-medium border border-ringo-border text-ringo-muted hover:text-ringo-text">
                    {p.active ? m.archivePlanCta : m.unarchivePlanCta}
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* -------------------------------- settings -------------------------------- */
function SettingsTab({ base, enabled, prefix, onSaved, m, a, err }: { base: string; enabled: boolean; prefix: string; onSaved: (e: boolean, p: string) => void; m: any; a: any; err: (c?: string) => string }) {
  const [en, setEn] = useState(enabled);
  const [pf, setPf] = useState(prefix);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [isError, setIsError] = useState(false);

  const save = async () => {
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`${base}/membership-settings`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: en, prefix: pf }) });
      const d = await res.json().catch(() => ({}));
      setIsError(!res.ok);
      setMsg(res.ok ? a.saved : err(d.code));
      if (res.ok) {
        setPf(d.prefix);
        onSaved(d.enabled, d.prefix);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-start gap-3 rounded-2xl border border-ringo-border/70 p-4 cursor-pointer">
        <input type="checkbox" checked={en} onChange={(e) => setEn(e.target.checked)} className="mt-1" />
        <span>
          <span className="block text-sm font-medium text-ringo-text">{m.enableLabel}</span>
          <span className="block text-xs text-ringo-muted mt-0.5">{m.enableHint}</span>
        </span>
      </label>
      <label className="flex flex-col gap-1 text-xs text-ringo-muted">
        {m.prefixLabel}
        <input value={pf} onChange={(e) => setPf(e.target.value)} maxLength={16} className={inputClass} />
        <span className="text-[11px]">{m.prefixHint}</span>
      </label>
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={busy} className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold bg-ringo-indigo text-white disabled:opacity-60">
          {busy && <Loader2 size={14} className="animate-spin" />} {m.saveSettingsCta}
        </button>
        {msg && <span className={`text-xs ${isError ? "text-ringo-coral" : "text-ringo-teal"}`}>{msg}</span>}
      </div>
    </div>
  );
}

/* --------------------------------- audit --------------------------------- */
function AuditTab({ base, locale, m }: { base: string; locale: string; m: any }) {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [more, setMore] = useState(false);

  const load = useCallback(
    async (before?: number) => {
      const res = await fetch(`${base}/audit${before ? `?before=${before}` : ""}`);
      const list: AuditRow[] = res.ok ? (await res.json()).entries || [] : [];
      setRows((cur) => (before && cur ? [...cur, ...list] : list));
      setMore(list.length === 50);
    },
    [base]
  );
  useEffect(() => {
    load();
  }, [load]);

  if (rows === null) return <Loading />;
  if (rows.length === 0) return <p className="text-sm text-ringo-muted">{m.auditEmpty}</p>;
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 rounded-xl border border-ringo-border/60 px-3.5 py-2.5 text-sm">
          <span className="text-ringo-text">{m.auditActions[r.action] || r.action}</span>
          <span className="text-xs text-ringo-muted text-right shrink-0">
            {r.actor_kind === "system" ? m.auditSystem : r.actor_role || ""} · {new Date(r.created_at).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short" })}
          </span>
        </div>
      ))}
      {more && (
        <button onClick={() => load(rows[rows.length - 1].id)} className="self-center px-4 py-2 rounded-full text-xs font-medium border border-ringo-border text-ringo-text">
          {m.loadMore}
        </button>
      )}
    </div>
  );
}
