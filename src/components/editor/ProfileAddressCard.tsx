"use client";

import { useEffect, useState } from "react";
import { Globe } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { useSectionSave } from "@/components/dashboard/sectionSave";
import { normalizeSubdomain, SUBDOMAIN_MAX } from "@/lib/profileSubdomain";
import EditorCard from "./EditorCard";

type Current = { enabled: boolean; allowed?: boolean; domain?: string; subdomain: string | null; address: string | null };

// Custom profile address (<name>.<profile domain>). Rendered only when the profile domain is configured (see Editor.tsx). "Check availability" is advisory; the dropdown's single
// Save Changes button is the real save, and the server decides (a name taken in between comes back as "taken" and the save reports failure).
export default function ProfileAddressCard() {
  const { t } = useLanguage();
  const copy = t.editor.profileAddress;
  const [current, setCurrent] = useState<Current | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/profile/subdomain")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Current | null) => {
        if (!alive || !d) return;
        setCurrent(d);
        setValue(d.subdomain || "");
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const errorText = (code?: string) => copy.errors[code || "generic"] || copy.errors.generic;
  const domain = current?.domain || "";

  const call = async (action: "check" | "save") => {
    const res = await fetch("/api/profile/subdomain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, subdomain: normalizeSubdomain(value) }),
    });
    return { res, data: await res.json().catch(() => ({})) };
  };

  const check = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const { data } = await call("check");
      setMessage(data.ok ? { kind: "ok", text: copy.available.replace("{address}", `${data.subdomain}.${domain}`) } : { kind: "error", text: errorText(data.code) });
    } catch {
      setMessage({ kind: "error", text: errorText() });
    } finally {
      setBusy(false);
    }
  };

  const save = async (): Promise<boolean> => {
    const wanted = normalizeSubdomain(value);
    if (!wanted || wanted === (current?.subdomain || "")) return true;
    try {
      const { data } = await call("save");
      if (!data.ok) {
        setMessage({ kind: "error", text: errorText(data.code) });
        return false;
      }
      setCurrent((c) => (c ? { ...c, subdomain: data.subdomain, address: data.address } : c));
      setValue(data.subdomain);
      setMessage({ kind: "ok", text: copy.saved });
      return true;
    } catch {
      setMessage({ kind: "error", text: copy.saveFailed });
      return false;
    }
  };
  // The dropdown's single Save Changes button runs this; no button of our own for saving.
  useSectionSave(save);

  const copyAddress = async () => {
    if (!current?.address) return;
    try {
      await navigator.clipboard.writeText(current.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {}
  };

  if (!current?.enabled || current.allowed === false) return null;

  return (
    <EditorCard icon={Globe} title={copy.title}>
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-xs text-ringo-muted mb-1">{copy.current}</p>
          {current.address ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <span className="text-sm font-medium text-ringo-text break-all">{current.address.replace("https://", "")}</span>
              <div className="flex gap-2">
                <button type="button" onClick={copyAddress} className="px-3 py-1.5 rounded-card border border-ringo-border text-xs font-medium text-ringo-text transition hover:bg-ringo-bg active:scale-[0.97]">
                  {copied ? copy.copied : copy.copy}
                </button>
                <a href={current.address} target="_blank" rel="noopener noreferrer" className="px-3 py-1.5 rounded-card border border-ringo-border text-xs font-medium text-ringo-text transition hover:bg-ringo-bg active:scale-[0.97]">
                  {copy.open}
                </a>
              </div>
            </div>
          ) : (
            <p className="text-sm text-ringo-muted">{copy.none}</p>
          )}
        </div>

        <div>
          <label htmlFor="profile-address-input" className="text-xs text-ringo-muted mb-1 block">{copy.label}</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex items-center flex-1 min-w-0 border border-ringo-border rounded-card bg-ringo-bg overflow-hidden">
              <input
                id="profile-address-input"
                value={value}
                maxLength={SUBDOMAIN_MAX + 10}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                inputMode="url"
                onChange={(e) => {
                  setValue(e.target.value);
                  setMessage(null);
                }}
                placeholder={copy.placeholder}
                className="flex-1 min-w-0 px-3 py-2 text-sm bg-transparent text-ringo-text outline-none"
              />
              <span className="pr-3 text-sm text-ringo-muted shrink-0">.{domain}</span>
            </div>
            <button
              type="button"
              onClick={check}
              disabled={busy || !value.trim()}
              className="px-4 py-2 rounded-card border border-ringo-border text-sm font-medium text-ringo-text transition hover:bg-ringo-bg active:scale-[0.97] disabled:opacity-50"
            >
              {busy ? copy.checking : copy.check}
            </button>
          </div>
          <p className="text-xs text-ringo-muted mt-1">{copy.hint}</p>
          {message && (
            <p role="status" className={`text-xs mt-2 ${message.kind === "ok" ? "text-green-600" : "text-red-600"}`}>
              {message.text}
            </p>
          )}
        </div>
      </div>
    </EditorCard>
  );
}
