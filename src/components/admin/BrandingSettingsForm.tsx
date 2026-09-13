"use client";

import { useRef, useState } from "react";
import { Loader2, Upload, Palette } from "lucide-react";
import SaveButton, { type SaveState } from "@/components/dashboard/SaveButton";
import type { BrandingSettings } from "@/lib/branding";

// /admin/branding — the admin-facing form for src/lib/branding.ts's
// singleton row. Logo/favicon go through /api/admin/branding/upload
// (server-side, service-role) rather than ImageUploadField.tsx's direct
// client-side storage upload — see that route's own comment on why:
// there's no per-user path to scope a storage policy to for a
// platform-wide asset. Every other field is a plain PATCH to
// /api/admin/branding.
export default function BrandingSettingsForm({ initial }: { initial: BrandingSettings }) {
  const [values, setValues] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState<"logo" | "favicon" | null>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof BrandingSettings>(key: K, value: BrandingSettings[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  const upload = async (kind: "logo" | "favicon", file: File) => {
    setUploading(kind);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", kind);
      const res = await fetch("/api/admin/branding/upload", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Upload failed.");
      set(kind === "logo" ? "logoUrl" : "faviconUrl", data.url);
    } catch (err: any) {
      setError(err?.message || "Upload failed. Try again.");
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    setSaveState("saving");
    setError("");
    try {
      const res = await fetch("/api/admin/branding", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Could not save.");
      setValues(
        data.branding
          ? {
              appName: data.branding.appName,
              shortName: data.branding.shortName,
              logoUrl: data.branding.logoUrl,
              faviconUrl: data.branding.faviconUrl,
              primaryColor: data.branding.primaryColor,
              pwaThemeColor: data.branding.pwaThemeColor,
              pwaBackgroundColor: data.branding.pwaBackgroundColor,
            }
          : values
      );
      setSaveState("success");
      setTimeout(() => setSaveState("idle"), 2000);
    } catch (err: any) {
      setError(err?.message || "Could not save — try again.");
      setSaveState("error");
    }
  };

  return (
    <div className="max-w-2xl flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold text-ringo-text flex items-center gap-2">
          <Palette size={20} className="text-ringo-indigo" />
          Branding &amp; App Appearance
        </h1>
        <p className="text-sm text-ringo-muted mt-1">
          Controls the platform's name, logo, and colors everywhere — the site header, login/signup, dashboard sidebars,
          browser favicon, and the installed PWA's own appearance.
        </p>
      </div>

      <Section title="Identity">
        <Field label="App name" hint="Shown in the browser title, PWA install name, and dashboard sidebars.">
          <input
            value={values.appName}
            onChange={(e) => set("appName", e.target.value)}
            className="w-full text-sm border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text"
          />
        </Field>
        <Field label="Short name" hint="Used where space is tight — the home-screen icon label on Android.">
          <input
            value={values.shortName}
            onChange={(e) => set("shortName", e.target.value)}
            className="w-full text-sm border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text"
          />
        </Field>
      </Section>

      <Section title="Logo & icon">
        <div className="grid sm:grid-cols-2 gap-5">
          <LogoUpload
            label="Main logo"
            hint="Header, sidebars, login panel."
            value={values.logoUrl}
            uploading={uploading === "logo"}
            inputRef={logoInputRef}
            onPick={(file) => upload("logo", file)}
          />
          <LogoUpload
            label="Favicon / app icon"
            hint="Browser tab and PWA home-screen icon."
            value={values.faviconUrl}
            uploading={uploading === "favicon"}
            inputRef={faviconInputRef}
            onPick={(file) => upload("favicon", file)}
          />
        </div>
      </Section>

      <Section title="Colors">
        <div className="grid sm:grid-cols-3 gap-5">
          <ColorField
            label="Primary brand color"
            hint="Buttons, links, accents across the app."
            value={values.primaryColor}
            onChange={(v) => set("primaryColor", v)}
          />
          <ColorField
            label="PWA theme color"
            hint="The status bar / task-switcher color once installed."
            value={values.pwaThemeColor}
            onChange={(v) => set("pwaThemeColor", v)}
          />
          <ColorField
            label="PWA background color"
            hint="Splash screen background on launch."
            value={values.pwaBackgroundColor}
            onChange={(v) => set("pwaBackgroundColor", v)}
          />
        </div>
      </Section>

      {error && <p className="text-sm text-ringo-coral">{error}</p>}

      <div>
        <SaveButton state={saveState} onClick={save} disabled={uploading !== null} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 flex flex-col gap-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ringo-muted">{title}</p>
      {children}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ringo-text">{label}</span>
      {children}
      {hint && <span className="text-xs text-ringo-muted">{hint}</span>}
    </label>
  );
}

function ColorField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ringo-text">{label}</span>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded-lg border border-ringo-border shrink-0 cursor-pointer bg-transparent"
          aria-label={`${label} picker`}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          maxLength={7}
          className="flex-1 min-w-0 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text font-mono"
        />
      </div>
      <span className="text-xs text-ringo-muted">{hint}</span>
    </div>
  );
}

function LogoUpload({
  label,
  hint,
  value,
  uploading,
  inputRef,
  onPick,
}: {
  label: string;
  hint: string;
  value: string;
  uploading: boolean;
  inputRef: React.RefObject<HTMLInputElement>;
  onPick: (file: File) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ringo-text">{label}</span>
      <div className="flex items-center gap-3">
        <span className="w-14 h-14 rounded-xl border border-ringo-border bg-ringo-bg overflow-hidden flex items-center justify-center shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="" className="w-full h-full object-contain" />
        </span>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 text-xs font-medium px-3 py-2 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors disabled:opacity-60"
        >
          {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
          {uploading ? "Uploading…" : "Upload"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
            e.target.value = "";
          }}
        />
      </div>
      <span className="text-xs text-ringo-muted">{hint}</span>
    </div>
  );
}
