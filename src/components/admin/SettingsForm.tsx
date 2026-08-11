"use client";

import { useState } from "react";
import { Check, ShieldCheck, AlertTriangle } from "lucide-react";

type Settings = {
  fapshiEnabled: boolean;
  stripeEnabled: boolean;
  fapshiApiUserSet: boolean;
  fapshiApiKeySet: boolean;
  fapshiBaseUrl: string;
  stripeSecretKeySet: boolean;
  stripeWebhookSecretSet: boolean;
  stripePricePro: string | null;
  stripePriceBusiness: string | null;
};

export default function SettingsForm({ initial }: { initial: Settings }) {
  const [settings, setSettings] = useState(initial);
  const [fapshiApiUser, setFapshiApiUser] = useState("");
  const [fapshiApiKey, setFapshiApiKey] = useState("");
  const [stripeSecretKey, setStripeSecretKey] = useState("");
  const [stripeWebhookSecret, setStripeWebhookSecret] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const toggle = async (field: "fapshiEnabled" | "stripeEnabled") => {
    const next = { ...settings, [field]: !settings[field] };
    setSettings(next);
    await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: next[field] }),
    });
  };

  const save = async () => {
    setSaving(true);
    setError("");
    const body: Record<string, any> = {
      fapshiBaseUrl: settings.fapshiBaseUrl,
      stripePricePro: settings.stripePricePro,
      stripePriceBusiness: settings.stripePriceBusiness,
    };
    // Only send secret fields that were actually typed into — leaving a
    // field blank must never wipe an already-configured key.
    if (fapshiApiUser) body.fapshiApiUser = fapshiApiUser;
    if (fapshiApiKey) body.fapshiApiKey = fapshiApiKey;
    if (stripeSecretKey) body.stripeSecretKey = stripeSecretKey;
    if (stripeWebhookSecret) body.stripeWebhookSecret = stripeWebhookSecret;

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
    setFapshiApiUser("");
    setFapshiApiKey("");
    setStripeSecretKey("");
    setStripeWebhookSecret("");
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
          Secret keys are encrypted before storage and never sent back to the browser — fields below show whether
          a key is configured, not the key itself.
        </p>
      </div>

      {/* Provider toggles */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h2 className="text-sm font-medium text-ringo-text mb-4">Providers</h2>
        <div className="flex flex-col gap-3">
          <label className="flex items-center justify-between">
            <div>
              <p className="text-sm text-ringo-text">Fapshi (Mobile Money — Cameroon)</p>
              <p className="text-xs text-ringo-muted">
                {settings.fapshiApiUserSet && settings.fapshiApiKeySet ? "Configured" : "Not configured yet"}
              </p>
            </div>
            <button
              onClick={() => toggle("fapshiEnabled")}
              role="switch"
              aria-checked={settings.fapshiEnabled}
              className={`w-10 h-6 rounded-full relative transition-colors ${
                settings.fapshiEnabled ? "bg-ringo-teal" : "bg-ringo-muted/30"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  settings.fapshiEnabled ? "translate-x-[18px]" : ""
                }`}
              />
            </button>
          </label>

          <label className="flex items-center justify-between">
            <div>
              <p className="text-sm text-ringo-text">Stripe (Card — everywhere else)</p>
              <p className="text-xs text-ringo-muted">
                {settings.stripeSecretKeySet ? "Configured" : "Not configured yet"}
              </p>
            </div>
            <button
              onClick={() => toggle("stripeEnabled")}
              role="switch"
              aria-checked={settings.stripeEnabled}
              className={`w-10 h-6 rounded-full relative transition-colors ${
                settings.stripeEnabled ? "bg-ringo-teal" : "bg-ringo-muted/30"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${
                  settings.stripeEnabled ? "translate-x-[18px]" : ""
                }`}
              />
            </button>
          </label>
        </div>
      </div>

      {/* Fapshi keys */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h2 className="text-sm font-medium text-ringo-text mb-1">Fapshi</h2>
        <p className="text-xs text-ringo-muted mb-4">From your Fapshi dashboard.</p>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">
              API user {settings.fapshiApiUserSet && <span className="text-ringo-teal">· configured</span>}
            </span>
            <input
              value={fapshiApiUser}
              onChange={(e) => setFapshiApiUser(e.target.value)}
              placeholder={settings.fapshiApiUserSet ? "Enter a new value to replace it" : "Not set"}
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">
              API key {settings.fapshiApiKeySet && <span className="text-ringo-teal">· configured</span>}
            </span>
            <input
              type="password"
              value={fapshiApiKey}
              onChange={(e) => setFapshiApiKey(e.target.value)}
              placeholder={settings.fapshiApiKeySet ? "Enter a new value to replace it" : "Not set"}
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">Base URL (sandbox vs live)</span>
            <select
              value={settings.fapshiBaseUrl}
              onChange={(e) => setSettings({ ...settings, fapshiBaseUrl: e.target.value })}
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            >
              <option value="https://sandbox.fapshi.com">Sandbox (testing)</option>
              <option value="https://live.fapshi.com">Live (real payments)</option>
            </select>
          </label>
        </div>
      </div>

      {/* Stripe keys */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <h2 className="text-sm font-medium text-ringo-text mb-1">Stripe</h2>
        <p className="text-xs text-ringo-muted mb-4">From your Stripe dashboard.</p>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">
              Secret key {settings.stripeSecretKeySet && <span className="text-ringo-teal">· configured</span>}
            </span>
            <input
              type="password"
              value={stripeSecretKey}
              onChange={(e) => setStripeSecretKey(e.target.value)}
              placeholder={settings.stripeSecretKeySet ? "Enter a new value to replace it" : "sk_live_… or sk_test_…"}
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">
              Webhook signing secret{" "}
              {settings.stripeWebhookSecretSet && <span className="text-ringo-teal">· configured</span>}
            </span>
            <input
              type="password"
              value={stripeWebhookSecret}
              onChange={(e) => setStripeWebhookSecret(e.target.value)}
              placeholder={settings.stripeWebhookSecretSet ? "Enter a new value to replace it" : "whsec_…"}
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">Pro plan Price ID</span>
            <input
              value={settings.stripePricePro || ""}
              onChange={(e) => setSettings({ ...settings, stripePricePro: e.target.value })}
              placeholder="price_…"
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">Business plan Price ID</span>
            <input
              value={settings.stripePriceBusiness || ""}
              onChange={(e) => setSettings({ ...settings, stripePriceBusiness: e.target.value })}
              placeholder="price_…"
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
          </label>
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