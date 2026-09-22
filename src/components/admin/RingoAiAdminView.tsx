"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Sparkles, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

type Settings = {
  enabled: boolean;
  accessMode: "allowlist" | "all_owners";
  provider: string;
  modelChat: string;
  effort: "low" | "medium" | "high";
  dailyMessageLimit: number;
  monthlyUserTokenLimit: number;
  monthlyGlobalBudgetUsd: number;
  maxToolRounds: number;
  maxOutputTokens: number;
  historyMessageLimit: number;
  pricing: { inputPerMTok: number | null; outputPerMTok: number | null; cacheReadPerMTok: number | null; cacheWritePerMTok: number | null };
};

type BetaUser = { userId: string; email: string | null; username: string | null; grantedAt: string; dailyLimitOverride: number | null; requests24h: number };

type Usage = {
  requests: number;
  failed: number;
  activeUsers: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  costUsd: number;
  costUnknownRequests: number;
  avgLatencyMs: number;
  errorsByCode: Record<string, number>;
  recentErrors: { at: string; code: string | null; model: string }[];
  feedback: { up: number; down: number };
};

type Form = Record<
  | "modelChat"
  | "dailyMessageLimit"
  | "monthlyUserTokenLimit"
  | "monthlyGlobalBudgetUsd"
  | "maxToolRounds"
  | "maxOutputTokens"
  | "historyMessageLimit"
  | "priceInputPerMTok"
  | "priceOutputPerMTok"
  | "priceCacheReadPerMTok"
  | "priceCacheWritePerMTok",
  string
>;

const str = (v: number | null) => (v === null || v === undefined ? "" : String(v));

function toForm(s: Settings): Form {
  return {
    modelChat: s.modelChat,
    dailyMessageLimit: str(s.dailyMessageLimit),
    monthlyUserTokenLimit: str(s.monthlyUserTokenLimit),
    monthlyGlobalBudgetUsd: str(s.monthlyGlobalBudgetUsd),
    maxToolRounds: str(s.maxToolRounds),
    maxOutputTokens: str(s.maxOutputTokens),
    historyMessageLimit: str(s.historyMessageLimit),
    priceInputPerMTok: str(s.pricing.inputPerMTok),
    priceOutputPerMTok: str(s.pricing.outputPerMTok),
    priceCacheReadPerMTok: str(s.pricing.cacheReadPerMTok),
    priceCacheWritePerMTok: str(s.pricing.cacheWritePerMTok),
  };
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 flex flex-col gap-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ringo-muted">{title}</p>
      {children}
    </div>
  );
}

const inputClass = "w-full text-sm border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ringo-text">{label}</span>
      {children}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-card border border-ringo-border/60 px-3 py-2.5">
      <p className="text-[11px] text-ringo-muted">{label}</p>
      <p className="text-base font-semibold text-ringo-text mt-0.5">{value}</p>
    </div>
  );
}

export default function RingoAiAdminView() {
  const { t, locale } = useLanguage();
  const a = t.ringoAiAdmin;
  const [settings, setSettings] = useState<Settings | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(false);
  const [pricingConfigured, setPricingConfigured] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "error">("idle");
  const [betaUsers, setBetaUsers] = useState<BetaUser[] | null>(null);
  const [betaEmail, setBetaEmail] = useState("");
  const [betaLimit, setBetaLimit] = useState("");
  const [betaError, setBetaError] = useState<string | null>(null);
  const [usage, setUsage] = useState<Usage | null>(null);
  const nf = new Intl.NumberFormat(locale === "fr" ? "fr-FR" : "en-US");

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ai/settings");
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSettings(data.settings);
      setForm(toForm(data.settings));
      setProviderConfigured(!!data.providerConfigured);
      setPricingConfigured(!!data.pricingConfigured);
    } catch {
      setLoadError(true);
    }
  }, []);

  const loadBeta = useCallback(async () => {
    const res = await fetch("/api/admin/ai/beta-users").catch(() => null);
    const data = res?.ok ? await res.json() : { users: [] };
    setBetaUsers(data.users || []);
  }, []);

  const loadUsage = useCallback(async () => {
    const res = await fetch("/api/admin/ai/usage").catch(() => null);
    if (res?.ok) setUsage(await res.json());
  }, []);

  useEffect(() => {
    loadSettings();
    loadBeta();
    loadUsage();
  }, [loadSettings, loadBeta, loadUsage]);

  const save = async (patch: Record<string, unknown>) => {
    setSaving(true);
    setSaveState("idle");
    try {
      const res = await fetch("/api/admin/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setSettings(data.settings);
      setForm(toForm(data.settings));
      setPricingConfigured(
        [data.settings.pricing.inputPerMTok, data.settings.pricing.outputPerMTok, data.settings.pricing.cacheReadPerMTok, data.settings.pricing.cacheWritePerMTok].every(
          (v: number | null) => v !== null
        )
      );
      setSaveState("saved");
    } catch {
      setSaveState("error");
    } finally {
      setSaving(false);
    }
  };

  const saveForm = () => {
    if (!form) return;
    const n = (v: string) => (v.trim() === "" ? null : Number(v));
    save({
      modelChat: form.modelChat,
      dailyMessageLimit: n(form.dailyMessageLimit),
      monthlyUserTokenLimit: n(form.monthlyUserTokenLimit),
      monthlyGlobalBudgetUsd: n(form.monthlyGlobalBudgetUsd),
      maxToolRounds: n(form.maxToolRounds),
      maxOutputTokens: n(form.maxOutputTokens),
      historyMessageLimit: n(form.historyMessageLimit),
      priceInputPerMTok: n(form.priceInputPerMTok),
      priceOutputPerMTok: n(form.priceOutputPerMTok),
      priceCacheReadPerMTok: n(form.priceCacheReadPerMTok),
      priceCacheWritePerMTok: n(form.priceCacheWritePerMTok),
    });
  };

  const addBeta = async () => {
    setBetaError(null);
    const res = await fetch("/api/admin/ai/beta-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: betaEmail, dailyLimitOverride: betaLimit.trim() ? Number(betaLimit) : null }),
    }).catch(() => null);
    if (res?.ok) {
      setBetaEmail("");
      setBetaLimit("");
      loadBeta();
    } else {
      setBetaError(res?.status === 404 ? a.betaUserNotFound : a.betaAddError);
    }
  };

  const removeBeta = async (userId: string) => {
    const res = await fetch(`/api/admin/ai/beta-users?userId=${encodeURIComponent(userId)}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) setBetaUsers((prev) => (prev || []).filter((u) => u.userId !== userId));
  };

  if (loadError) return <p className="text-sm text-ringo-coral">{a.loadError}</p>;
  if (!settings || !form) {
    return (
      <div className="flex items-center gap-2 text-sm text-ringo-muted">
        <Loader2 size={16} className="animate-spin" />
        {a.loading}
      </div>
    );
  }

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  return (
    <div className="max-w-3xl flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-ringo-text flex items-center gap-2">
          <Sparkles size={20} className="text-ringo-indigo" />
          {a.title}
        </h1>
        <p className="text-sm text-ringo-muted mt-1">{a.subtitle}</p>
      </div>

      <Card title={a.statusTitle}>
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={saving}
            onChange={(e) => save({ enabled: e.target.checked })}
            className="mt-1 w-4 h-4 accent-[rgb(var(--ringo-indigo))]"
          />
          <span>
            <span className="block text-sm font-medium text-ringo-text">{a.enabledLabel}</span>
            <span className="block text-xs text-ringo-muted">{a.enabledHint}</span>
          </span>
        </label>
        <p className={`text-xs flex items-center gap-1.5 ${providerConfigured ? "text-emerald-600" : "text-ringo-coral"}`}>
          {providerConfigured ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
          {providerConfigured ? a.providerOk : a.providerMissing}
        </p>
        <Field label={a.accessTitle}>
          <select
            value={settings.accessMode}
            disabled={saving}
            onChange={(e) => save({ accessMode: e.target.value })}
            className={inputClass}
          >
            <option value="allowlist">{a.accessAllowlist}</option>
            <option value="all_owners">{a.accessAllOwners}</option>
          </select>
        </Field>
      </Card>

      <Card title={a.modelTitle}>
        <div className="grid sm:grid-cols-3 gap-4">
          <Field label={a.providerLabel}>
            <input value={settings.provider} disabled className={`${inputClass} opacity-70`} />
          </Field>
          <Field label={a.modelLabel}>
            <input value={form.modelChat} onChange={set("modelChat")} className={inputClass} />
          </Field>
          <Field label={a.effortLabel}>
            <select value={settings.effort} disabled={saving} onChange={(e) => save({ effort: e.target.value })} className={inputClass}>
              <option value="low">{a.effortLow}</option>
              <option value="medium">{a.effortMedium}</option>
              <option value="high">{a.effortHigh}</option>
            </select>
          </Field>
        </div>
      </Card>

      <Card title={a.limitsTitle}>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label={a.dailyLimit}>
            <input type="number" min={0} value={form.dailyMessageLimit} onChange={set("dailyMessageLimit")} className={inputClass} />
          </Field>
          <Field label={a.monthlyTokens}>
            <input type="number" min={0} value={form.monthlyUserTokenLimit} onChange={set("monthlyUserTokenLimit")} className={inputClass} />
          </Field>
          <Field label={a.monthlyBudget}>
            <input type="number" min={0} step="0.01" value={form.monthlyGlobalBudgetUsd} onChange={set("monthlyGlobalBudgetUsd")} className={inputClass} />
          </Field>
          <Field label={a.maxToolRounds}>
            <input type="number" min={0} max={8} value={form.maxToolRounds} onChange={set("maxToolRounds")} className={inputClass} />
          </Field>
          <Field label={a.maxOutputTokens}>
            <input type="number" min={512} max={16000} value={form.maxOutputTokens} onChange={set("maxOutputTokens")} className={inputClass} />
          </Field>
          <Field label={a.historyLimit}>
            <input type="number" min={2} max={40} value={form.historyMessageLimit} onChange={set("historyMessageLimit")} className={inputClass} />
          </Field>
        </div>
      </Card>

      <Card title={a.pricingTitle}>
        <p className="text-xs text-ringo-muted">{a.pricingHint}</p>
        {!pricingConfigured && (
          <p className="text-xs text-ringo-coral flex items-center gap-1.5">
            <AlertTriangle size={14} />
            {a.pricingMissing}
          </p>
        )}
        <div className="grid sm:grid-cols-4 gap-4">
          <Field label={a.priceInput}>
            <input type="number" min={0} step="0.01" value={form.priceInputPerMTok} onChange={set("priceInputPerMTok")} className={inputClass} />
          </Field>
          <Field label={a.priceOutput}>
            <input type="number" min={0} step="0.01" value={form.priceOutputPerMTok} onChange={set("priceOutputPerMTok")} className={inputClass} />
          </Field>
          <Field label={a.priceCacheRead}>
            <input type="number" min={0} step="0.01" value={form.priceCacheReadPerMTok} onChange={set("priceCacheReadPerMTok")} className={inputClass} />
          </Field>
          <Field label={a.priceCacheWrite}>
            <input type="number" min={0} step="0.01" value={form.priceCacheWritePerMTok} onChange={set("priceCacheWritePerMTok")} className={inputClass} />
          </Field>
        </div>
      </Card>

      <div className="flex items-center gap-3">
        <button
          onClick={saveForm}
          disabled={saving}
          className="px-5 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-semibold disabled:opacity-60"
        >
          {saving ? a.saving : a.save}
        </button>
        {saveState === "saved" && <span className="text-sm text-emerald-600">{a.saved}</span>}
        {saveState === "error" && <span className="text-sm text-ringo-coral">{a.saveError}</span>}
      </div>

      <Card title={a.betaTitle}>
        <div className="flex flex-col sm:flex-row gap-2">
          <input value={betaEmail} onChange={(e) => setBetaEmail(e.target.value)} placeholder={a.betaEmailPlaceholder} className={`${inputClass} sm:flex-1`} />
          <input
            type="number"
            min={0}
            value={betaLimit}
            onChange={(e) => setBetaLimit(e.target.value)}
            placeholder={a.betaLimitPlaceholder}
            className={`${inputClass} sm:w-44`}
          />
          <button
            onClick={addBeta}
            disabled={!betaEmail.trim()}
            className="px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-semibold disabled:opacity-50"
          >
            {a.betaAdd}
          </button>
        </div>
        {betaError && <p className="text-xs text-ringo-coral">{betaError}</p>}
        {betaUsers === null ? (
          <Loader2 size={16} className="animate-spin text-ringo-muted" />
        ) : betaUsers.length === 0 ? (
          <p className="text-sm text-ringo-muted">{a.betaEmpty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-ringo-muted">
                  <th className="py-2 pr-3 font-medium">{a.betaColumnUser}</th>
                  <th className="py-2 pr-3 font-medium">{a.betaColumnLimit}</th>
                  <th className="py-2 pr-3 font-medium">{a.betaColumnToday}</th>
                  <th className="py-2 pr-3 font-medium">{a.betaColumnSince}</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {betaUsers.map((u) => (
                  <tr key={u.userId} className="border-t border-ringo-border/60">
                    <td className="py-2 pr-3">
                      <p className="text-ringo-text">{u.email ?? u.userId}</p>
                      {u.username && <p className="text-xs text-ringo-muted">@{u.username}</p>}
                    </td>
                    <td className="py-2 pr-3 text-ringo-text">{u.dailyLimitOverride ?? a.betaDefaultLimit}</td>
                    <td className="py-2 pr-3 text-ringo-text">{u.requests24h}</td>
                    <td className="py-2 pr-3 text-ringo-muted">{new Date(u.grantedAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB")}</td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeBeta(u.userId)} aria-label={a.betaRemove} className="p-1.5 rounded-lg text-ringo-muted hover:text-ringo-coral">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {usage && (
        <Card title={a.usageTitle}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat label={a.usageRequests} value={nf.format(usage.requests)} />
            <Stat label={a.usageFailed} value={nf.format(usage.failed)} />
            <Stat label={a.usageUsers} value={nf.format(usage.activeUsers)} />
            <Stat label={a.usageCost} value={`$${usage.costUsd.toFixed(2)}`} />
            <Stat label={a.usageTokensIn} value={nf.format(usage.inputTokens)} />
            <Stat label={a.usageTokensOut} value={nf.format(usage.outputTokens)} />
            <Stat label={a.usageCacheRead} value={nf.format(usage.cacheReadTokens)} />
            <Stat label={a.usageLatency} value={`${(usage.avgLatencyMs / 1000).toFixed(1)} s`} />
          </div>
          {usage.costUnknownRequests > 0 && <p className="text-xs text-ringo-muted">{a.usageCostUnknown(usage.costUnknownRequests)}</p>}
          <p className="text-sm text-ringo-text">
            {a.usageFeedback}: 👍 {usage.feedback.up} · 👎 {usage.feedback.down}
          </p>
          <div>
            <p className="text-sm font-medium text-ringo-text mb-1">{a.usageErrors}</p>
            {Object.keys(usage.errorsByCode).length === 0 ? (
              <p className="text-xs text-ringo-muted">{a.usageNoErrors}</p>
            ) : (
              <ul className="text-xs text-ringo-muted flex flex-col gap-0.5">
                {Object.entries(usage.errorsByCode).map(([code, count]) => (
                  <li key={code}>
                    <code>{code}</code>: {count}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {usage.recentErrors.length > 0 && (
            <div>
              <p className="text-sm font-medium text-ringo-text mb-1">{a.usageRecentErrors}</p>
              <ul className="text-xs text-ringo-muted flex flex-col gap-0.5">
                {usage.recentErrors.map((e, i) => (
                  <li key={i}>
                    {new Date(e.at).toLocaleString(locale === "fr" ? "fr-FR" : "en-GB")} — <code>{e.code}</code> ({e.model})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
