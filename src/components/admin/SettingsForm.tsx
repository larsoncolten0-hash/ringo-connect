"use client";

import { useState } from "react";
import { Check, ShieldCheck, AlertTriangle } from "lucide-react";

type Settings = {
  fapshiEnabled: boolean;
  stripeEnabled: boolean;
  fapshiTestMode: boolean;
  stripeTestMode: boolean;
  fapshiApiUserTestSet: boolean;
  fapshiApiKeyTestSet: boolean;
  fapshiApiUserLiveSet: boolean;
  fapshiApiKeyLiveSet: boolean;
  stripeSecretKeyTestSet: boolean;
  stripeWebhookSecretTestSet: boolean;
  stripePriceProTest: string | null;
  stripePriceProYearlyTest: string | null;
  stripePriceBusinessTest: string | null;
  stripePriceBusinessYearlyTest: string | null;
  stripeSecretKeyLiveSet: boolean;
  stripeWebhookSecretLiveSet: boolean;
  stripePriceProLive: string | null;
  stripePriceProYearlyLive: string | null;
  stripePriceBusinessLive: string | null;
  stripePriceBusinessYearlyLive: string | null;
};

function ModeSwitch({
  testMode,
  onChange,
}: {
  testMode: boolean;
  onChange: (testMode: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-1 bg-ringo-muted/10 rounded-full p-1">
      <button
        onClick={() => onChange(true)}
        className={`text-xs font-medium px-3 py-1 rounded-full transition ${
          testMode ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"
        }`}
      >
        Test
      </button>
      <button
        onClick={() => onChange(false)}
        className={`text-xs font-medium px-3 py-1 rounded-full transition ${
          !testMode ? "bg-ringo-coral text-white shadow-sm" : "text-ringo-muted"
        }`}
      >
        Live
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  configured,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  configured?: boolean;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-ringo-muted">
        {label} {configured && <span className="text-ringo-teal">· configured</span>}
      </span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder || (configured ? "Enter a new value to replace it" : "Not set")}
        className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
      />
    </label>
  );
}

export default function SettingsForm({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const setDraftField = (key: string, value: string) => setDraft((d) => ({ ...d, [key]: value }));

  const toggle = async (field: "fapshiEnabled" | "stripeEnabled") => {
    const next = { ...settings, [field]: !settings[field] };
    setSettings(next);
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: next[field] }),
    });
  };

  const setMode = async (field: "fapshiTestMode" | "stripeTestMode", testMode: boolean) => {
    const next = { ...settings, [field]: testMode };
    setSettings(next);
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: testMode }),
    });
  };

  const save = async () => {
    setSaving(true);
    setError("");

    const body: Record<string, any> = {
      stripePriceProTest: settings.stripePriceProTest,
      stripePriceProYearlyTest: settings.stripePriceProYearlyTest,
      stripePriceBusinessTest: settings.stripePriceBusinessTest,
      stripePriceBusinessYearlyTest: settings.stripePriceBusinessYearlyTest,
      stripePriceProLive: settings.stripePriceProLive,
      stripePriceProYearlyLive: settings.stripePriceProYearlyLive,
      stripePriceBusinessLive: settings.stripePriceBusinessLive,
      stripePriceBusinessYearlyLive: settings.stripePriceBusinessYearlyLive,
    };
    // Only send secret fields that were actually typed into — leaving a
    // field blank must never wipe an already-configured key.
    for (const key of [
      "fapshiApiUserTest",
      "fapshiApiKeyTest",
      "fapshiApiUserLive",
      "fapshiApiKeyLive",
      "stripeSecretKeyTest",
      "stripeWebhookSecretTest",
      "stripeSecretKeyLive",
      "stripeWebhookSecretLive",
    ]) {
      if (draft[key]) body[key] = draft[key];
    }

    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    setSaving(false);

    if (!res.ok) {
      setError(data.error || "Could not save settings");
      return;
    }

    setSettings(data.settings);
    setDraft({});
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="max-w-2xl flex flex-col gap-5">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">
          Payment provider settings
        </h1>
        <p className="text-sm text-ringo-muted mt-1 flex items-start gap-1.5">
          <ShieldCheck size={14} className="text-ringo-teal shrink-0 mt-0.5" />
          Secret keys are encrypted before storage and never sent back to the browser. Test and live credentials
          are both stored independently — switching modes never loses the other set.
        </p>
      </div>

      {/* Provider on/off toggles */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h2 className="text-sm font-medium text-ringo-text mb-4">Providers</h2>
        <div className="flex flex-col gap-3">
          {(["fapshiEnabled", "stripeEnabled"] as const).map((field) => (
            <label key={field} className="flex items-center justify-between">
              <p className="text-sm text-ringo-text">
                {field === "fapshiEnabled" ? "Fapshi (Mobile Money — Cameroon)" : "Stripe (Card — everywhere else)"}
              </p>
              <button
                onClick={() => toggle(field)}
                role="switch"
                aria-checked={settings[field]}
                className={`w-10 h-6 rounded-full relative transition-colors ${
                  settings[field] ? "bg-ringo-teal" : "bg-ringo-muted/30"
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                    settings[field] ? "translate-x-[18px]" : ""
                  }`}
                />
              </button>
            </label>
          ))}
        </div>
      </div>

      {/* Fapshi credentials */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-medium text-ringo-text">Fapshi</h2>
          <ModeSwitch testMode={settings.fapshiTestMode} onChange={(v) => setMode("fapshiTestMode", v)} />
        </div>
        <p className="text-xs text-ringo-muted mb-4">
          Currently using <strong className={settings.fapshiTestMode ? "text-ringo-text" : "text-ringo-coral"}>
            {settings.fapshiTestMode ? "sandbox.fapshi.com" : "live.fapshi.com"}
          </strong>{" "}
          for real checkouts.
        </p>

        <div className="grid sm:grid-cols-2 gap-5">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium text-ringo-muted uppercase tracking-wide">Test credentials</p>
            <Field
              label="API user"
              value={draft.fapshiApiUserTest ?? ""}
              onChange={(v) => setDraftField("fapshiApiUserTest", v)}
              configured={settings.fapshiApiUserTestSet}
            />
            <Field
              label="API key"
              type="password"
              value={draft.fapshiApiKeyTest ?? ""}
              onChange={(v) => setDraftField("fapshiApiKeyTest", v)}
              configured={settings.fapshiApiKeyTestSet}
            />
          </div>
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium text-ringo-coral uppercase tracking-wide">Live credentials</p>
            <Field
              label="API user"
              value={draft.fapshiApiUserLive ?? ""}
              onChange={(v) => setDraftField("fapshiApiUserLive", v)}
              configured={settings.fapshiApiUserLiveSet}
            />
            <Field
              label="API key"
              type="password"
              value={draft.fapshiApiKeyLive ?? ""}
              onChange={(v) => setDraftField("fapshiApiKeyLive", v)}
              configured={settings.fapshiApiKeyLiveSet}
            />
          </div>
        </div>
      </div>

      {/* Stripe credentials */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-medium text-ringo-text">Stripe</h2>
          <ModeSwitch testMode={settings.stripeTestMode} onChange={(v) => setMode("stripeTestMode", v)} />
        </div>
        <p className="text-xs text-ringo-muted mb-4">
          Stripe segregates test and live data entirely — Price IDs from test mode won't work in live mode and
          vice versa, so each needs its own set.
        </p>

        <div className="grid sm:grid-cols-2 gap-5">
          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium text-ringo-muted uppercase tracking-wide">Test</p>
            <Field
              label="Secret key"
              type="password"
              value={draft.stripeSecretKeyTest ?? ""}
              onChange={(v) => setDraftField("stripeSecretKeyTest", v)}
              configured={settings.stripeSecretKeyTestSet}
              placeholder="sk_test_…"
            />
            <Field
              label="Webhook signing secret"
              type="password"
              value={draft.stripeWebhookSecretTest ?? ""}
              onChange={(v) => setDraftField("stripeWebhookSecretTest", v)}
              configured={settings.stripeWebhookSecretTestSet}
              placeholder="whsec_…"
            />
            <Field
              label="Pro — monthly Price ID"
              value={settings.stripePriceProTest ?? ""}
              onChange={(v) => setSettings({ ...settings, stripePriceProTest: v })}
              placeholder="price_…"
            />
            <Field
              label="Pro — yearly Price ID"
              value={settings.stripePriceProYearlyTest ?? ""}
              onChange={(v) => setSettings({ ...settings, stripePriceProYearlyTest: v })}
              placeholder="price_…"
            />
            <Field
              label="Business — monthly Price ID"
              value={settings.stripePriceBusinessTest ?? ""}
              onChange={(v) => setSettings({ ...settings, stripePriceBusinessTest: v })}
              placeholder="price_…"
            />
            <Field
              label="Business — yearly Price ID"
              value={settings.stripePriceBusinessYearlyTest ?? ""}
              onChange={(v) => setSettings({ ...settings, stripePriceBusinessYearlyTest: v })}
              placeholder="price_…"
            />
          </div>

          <div className="flex flex-col gap-3">
            <p className="text-xs font-medium text-ringo-coral uppercase tracking-wide">Live</p>
            <Field
              label="Secret key"
              type="password"
              value={draft.stripeSecretKeyLive ?? ""}
              onChange={(v) => setDraftField("stripeSecretKeyLive", v)}
              configured={settings.stripeSecretKeyLiveSet}
              placeholder="sk_live_…"
            />
            <Field
              label="Webhook signing secret"
              type="password"
              value={draft.stripeWebhookSecretLive ?? ""}
              onChange={(v) => setDraftField("stripeWebhookSecretLive", v)}
              configured={settings.stripeWebhookSecretLiveSet}
              placeholder="whsec_…"
            />
            <Field
              label="Pro — monthly Price ID"
              value={settings.stripePriceProLive ?? ""}
              onChange={(v) => setSettings({ ...settings, stripePriceProLive: v })}
              placeholder="price_…"
            />
            <Field
              label="Pro — yearly Price ID"
              value={settings.stripePriceProYearlyLive ?? ""}
              onChange={(v) => setSettings({ ...settings, stripePriceProYearlyLive: v })}
              placeholder="price_…"
            />
            <Field
              label="Business — monthly Price ID"
              value={settings.stripePriceBusinessLive ?? ""}
              onChange={(v) => setSettings({ ...settings, stripePriceBusinessLive: v })}
              placeholder="price_…"
            />
            <Field
              label="Business — yearly Price ID"
              value={settings.stripePriceBusinessYearlyLive ?? ""}
              onChange={(v) => setSettings({ ...settings, stripePriceBusinessYearlyLive: v })}
              placeholder="price_…"
            />
          </div>
        </div>
      </div>

      {error && (
        <p className="text-sm text-red-500 flex items-center gap-1.5">
          <AlertTriangle size={14} />
          {error}
        </p>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="self-start flex items-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-50"
      >
        {saved && <Check size={14} />}
        {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
      </button>
    </div>
  );
}