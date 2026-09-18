"use client";

import { useState } from "react";
import { X, Loader2, Search, Copy, Check } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

interface SearchResult {
  id: string;
  username: string;
  name: string | null;
  avatar_url: string | null;
}

export default function InvitePartnerModal({
  associationProfileId,
  onClose,
  onInvited,
}: {
  associationProfileId: string;
  onClose: () => void;
  onInvited: () => void;
}) {
  const { t } = useLanguage();
  const a = t.association;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);

  const search = async (q: string) => {
    setQuery(q);
    setSelected(null);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/association/search-profile?associationProfileId=${associationProfileId}&q=${encodeURIComponent(q)}`);
      const data = await res.json();
      setResults(data.profiles || []);
    } finally {
      setSearching(false);
    }
  };

  const invite = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/association/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ associationProfileId, method: "link", inviteeProfileId: selected.id, inviteeUsername: selected.username }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((a.errors as Record<string, string>)[data.code] || data.error || a.genericError);
      setInviteUrl(data.inviteUrl);
      onInvited();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const copyLink = () => {
    navigator.clipboard?.writeText(inviteUrl).then(() => {
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

        {inviteUrl ? (
          <div className="flex flex-col items-center text-center gap-3 py-2">
            <span className="w-14 h-14 rounded-full bg-ringo-teal/10 flex items-center justify-center">
              <Check size={26} className="text-ringo-teal" />
            </span>
            <p className="text-sm font-medium text-ringo-text">{a.invitationSentTitle}</p>
            <button
              onClick={copyLink}
              className="w-full flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-card border border-ringo-border text-xs font-mono text-ringo-text hover:bg-ringo-muted/10 transition"
            >
              <span className="truncate">{inviteUrl}</span>
              {copied ? <Check size={13} className="text-ringo-teal shrink-0" /> : <Copy size={13} className="shrink-0" />}
            </button>
            <button onClick={onClose} className="w-full rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5 mt-2">
              {a.doneCta}
            </button>
          </div>
        ) : (
          <>
            <h2 className="font-display text-lg font-medium text-ringo-text mb-1">{a.invitePartnerTitle}</h2>
            <p className="text-sm text-ringo-muted mb-4">{a.invitePartnerSubtitle}</p>

            {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

            <div className="relative mb-3">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ringo-muted" />
              <input
                value={query}
                onChange={(e) => search(e.target.value)}
                placeholder={a.searchProfilePlaceholder}
                className="w-full pl-9 pr-3.5 py-2.5 rounded-card border border-ringo-border bg-ringo-bg text-sm"
              />
            </div>

            {searching && (
              <div className="flex justify-center py-3">
                <Loader2 size={16} className="animate-spin text-ringo-muted" />
              </div>
            )}

            {!searching && results.length > 0 && (
              <div className="flex flex-col gap-1.5 mb-4 max-h-48 overflow-y-auto">
                {results.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-card text-left transition ${
                      selected?.id === r.id ? "bg-ringo-indigo/10 border border-ringo-indigo" : "hover:bg-ringo-muted/10 border border-transparent"
                    }`}
                  >
                    <span className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-ringo-indigo text-white text-xs font-medium shrink-0">
                      {r.avatar_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.avatar_url} alt={r.username} className="w-full h-full object-cover" />
                      ) : (
                        r.username[0]?.toUpperCase()
                      )}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ringo-text truncate">{r.name || r.username}</span>
                      <span className="block text-xs text-ringo-muted truncate">@{r.username}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}

            <button
              onClick={invite}
              disabled={!selected || busy}
              className="w-full py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-60"
            >
              {busy ? <Loader2 size={15} className="animate-spin mx-auto" /> : a.sendInviteCta}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
