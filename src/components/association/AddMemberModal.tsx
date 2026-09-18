"use client";

import { useState } from "react";
import { X, Loader2, Search, Check, Nfc, Copy, ShieldAlert } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { isWebNfcSupported, isSecureContextAvailable, writeRingoCardUrl, RingoCardError } from "@/lib/ringoCardWriter";

interface SearchResult {
  id: string;
  username: string;
  name: string | null;
  avatar_url: string | null;
}

type Stage = "form" | "created" | "writing" | "written" | "card-error";

// Member creation + optional card binding, in one flow. Linking an existing
// Ringo account is entirely optional (per the product decision) — most
// Members will skip it. Card binding reuses the exact same Web NFC write
// function the Ringo Card Writer feature already uses
// (src/lib/ringoCardWriter.ts) — only the URL written to the chip differs
// (a Member's own member_card_url, computed server-side).
export default function AddMemberModal({
  associationProfileId,
  onClose,
  onCreated,
}: {
  associationProfileId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useLanguage();
  const a = t.association;
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<SearchResult[]>([]);
  const [linkedProfile, setLinkedProfile] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stage, setStage] = useState<Stage>("form");
  const [memberId, setMemberId] = useState("");
  const [memberViewUrl, setMemberViewUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const searchLink = async (q: string) => {
    setLinkQuery(q);
    setLinkedProfile(null);
    if (q.trim().length < 2) {
      setLinkResults([]);
      return;
    }
    const res = await fetch(`/api/association/search-profile?associationProfileId=${associationProfileId}&q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setLinkResults(data.profiles || []);
  };

  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/association/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ associationProfileId, name, phone, linkedProfileId: linkedProfile?.id || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((a.errors as Record<string, string>)[data.code] || data.error || a.genericError);
      setMemberId(data.member.id);
      setMemberViewUrl(data.memberViewUrl);
      onCreated();
      setStage("created");
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const bindCard = async () => {
    if (!isWebNfcSupported() || !isSecureContextAvailable()) {
      setError(a.nfcUnsupported);
      setStage("card-error");
      return;
    }
    setStage("writing");
    setError("");
    try {
      const res = await fetch(`/api/association/members/${memberId}/card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ associationProfileId }),
      });
      const data = await res.json();
      if (!res.ok || !data.card) throw new Error(data.error || a.genericError);

      await writeRingoCardUrl(data.card.member_card_url);

      const writeRes = await fetch(`/api/association/members/${memberId}/card/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ associationProfileId, cardId: data.card.id }),
      });
      if (!writeRes.ok) throw new Error(a.genericError);

      setStage("written");
    } catch (err) {
      setError(err instanceof RingoCardError ? a.nfcErrors[err.code] || a.genericError : a.genericError);
      setStage("card-error");
    }
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(memberViewUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-sm rounded-card bg-ringo-surface border border-ringo-border p-6">
        <button onClick={onClose} aria-label="Close" className="absolute right-4 top-4 text-ringo-muted hover:text-ringo-text">
          <X size={18} />
        </button>

        {stage === "form" && (
          <>
            <h2 className="font-display text-lg font-medium text-ringo-text mb-1">{a.addMemberTitle}</h2>
            <p className="text-sm text-ringo-muted mb-4">{a.addMemberSubtitle}</p>
            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

            <div className="flex flex-col gap-3 mb-4">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={a.memberNamePlaceholder}
                className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-bg"
              />
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={a.memberPhonePlaceholder}
                inputMode="tel"
                className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-bg"
              />

              <div>
                <p className="text-xs font-medium text-ringo-text mb-1.5">{a.linkExistingAccountLabel}</p>
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ringo-muted" />
                  <input
                    value={linkQuery}
                    onChange={(e) => searchLink(e.target.value)}
                    placeholder={a.searchProfilePlaceholder}
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-card border border-ringo-border bg-ringo-bg text-sm"
                  />
                </div>
                {linkedProfile ? (
                  <p className="text-xs text-ringo-teal mt-1.5 flex items-center gap-1">
                    <Check size={12} /> {a.linkedTo(linkedProfile.username)}
                  </p>
                ) : (
                  linkResults.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1.5">
                      {linkResults.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => {
                            setLinkedProfile(r);
                            setLinkResults([]);
                          }}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-card text-left hover:bg-ringo-muted/10 text-xs"
                        >
                          @{r.username} {r.name ? `(${r.name})` : ""}
                        </button>
                      ))}
                    </div>
                  )
                )}
                <p className="text-[11px] text-ringo-muted mt-1">{a.linkExistingAccountHint}</p>
              </div>
            </div>

            <button
              onClick={create}
              disabled={busy || !name.trim()}
              className="w-full py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-60"
            >
              {busy ? <Loader2 size={15} className="animate-spin mx-auto" /> : a.createMemberCta}
            </button>
          </>
        )}

        {stage === "created" && (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <span className="w-14 h-14 rounded-full bg-ringo-teal/10 flex items-center justify-center">
              <Check size={26} className="text-ringo-teal" />
            </span>
            <p className="text-sm font-medium text-ringo-text">{a.memberCreatedTitle}</p>

            <button
              onClick={copyLink}
              className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-card border border-ringo-border text-xs font-mono text-ringo-text hover:bg-ringo-muted/10 transition"
            >
              <span className="truncate">{memberViewUrl}</span>
              {copied ? <Check size={13} className="text-ringo-teal shrink-0" /> : <Copy size={13} className="shrink-0" />}
            </button>

            <button onClick={bindCard} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium">
              <Nfc size={15} /> {a.bindCardCta}
            </button>
            <button onClick={onClose} className="text-sm text-ringo-muted hover:text-ringo-text transition">
              {a.skipForNowCta}
            </button>
          </div>
        )}

        {stage === "writing" && (
          <div className="flex flex-col items-center text-center gap-3 py-6">
            <Nfc size={32} className="text-ringo-indigo animate-pulse" />
            <p className="text-sm font-medium text-ringo-text">{a.holdCardNearPhone}</p>
          </div>
        )}

        {stage === "written" && (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <span className="w-14 h-14 rounded-full bg-ringo-teal/10 flex items-center justify-center">
              <Check size={26} className="text-ringo-teal" />
            </span>
            <p className="text-sm font-medium text-ringo-text">{a.cardBoundTitle}</p>
            <button onClick={onClose} className="w-full rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5">
              {a.doneCta}
            </button>
          </div>
        )}

        {stage === "card-error" && (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <span className="w-14 h-14 rounded-full bg-ringo-coral/10 flex items-center justify-center">
              <ShieldAlert size={24} className="text-ringo-coral" />
            </span>
            <p className="text-sm text-ringo-text">{error}</p>
            <button onClick={bindCard} className="w-full rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5">
              {a.tryAgainCta}
            </button>
            <button onClick={onClose} className="text-sm text-ringo-muted hover:text-ringo-text transition">
              {a.skipForNowCta}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
