"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Copy, Check, Loader2, Search, ShieldAlert, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { CustomerLoyaltyProfile } from "@/lib/loyalty/customerProfile";
import CustomerLoyaltyCard, { type TemplateOption } from "@/components/loyalty/CustomerLoyaltyCard";
import { api, codeOf, outcomeText } from "@/components/loyalty/format";
import { useQrScanner } from "@/components/loyalty/useQrScanner";

type View =
  | { name: "home" }
  | { name: "resolving" }
  | { name: "not_connected" }
  | { name: "customer"; profile: CustomerLoyaltyProfile; via: "scan" | "search" };

interface Hit {
  connectionId: string;
  name: string;
  emailHint: string | null;
  phoneHint: string | null;
}

// "Scan customer -> record activity -> done", built for a phone handed to staff.
// Scanning is the main path; searching among the business's own connected customers is the
// fallback. The camera opens only when the button is tapped.
export default function LoyaltyScanner({
  can,
  username,
  templates,
}: {
  can: { scan: boolean; manage: boolean; reverse: boolean };
  username: string;
  templates: TemplateOption[];
}) {
  const { t } = useLanguage();
  const L = t.loyalty;
  const [view, setView] = useState<View>({ name: "home" });
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const searchSeq = useRef(0);

  const onCode = useCallback(
    async (text: string) => {
      setError(null);
      setView({ name: "resolving" });
      const res = await api("/api/loyalty/scan/resolve", { body: { code: text } });
      if (res.status === 200 && res.data?.profile) return setView({ name: "customer", profile: res.data.profile, via: "scan" });
      const code = codeOf(res);
      if (code === "not_connected") return setView({ name: "not_connected" });
      setView({ name: "home" });
      if (code === "network") setError(L.scan.network);
      else if (code === "invalid_qr") setError(L.scan.invalidQr);
      else if (res.status === 401) setError(L.scan.sessionExpired);
      else if (res.status === 403) setError(L.scan.forbidden);
      else setError(L.scan.generic);
    },
    [L]
  );

  const scanner = useQrScanner(onCode);

  // Debounced search among the business's own connected customers.
  useEffect(() => {
    const q = term.trim();
    if (q.length < 3) {
      setHits(null);
      setSearching(false);
      return;
    }
    const seq = ++searchSeq.current;
    setSearching(true);
    const timer = setTimeout(async () => {
      const res = await api(`/api/loyalty/customers/search?q=${encodeURIComponent(q)}`);
      if (seq !== searchSeq.current) return;
      setSearching(false);
      if (res.status === 200) setHits((res.data?.hits ?? []) as Hit[]);
      else {
        setHits([]);
        setError(res.status === 0 ? L.scan.network : outcomeText(L, codeOf(res)));
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [term, L]);

  async function openHit(hit: Hit) {
    setError(null);
    setView({ name: "resolving" });
    const res = await api("/api/loyalty/customers/profile", { body: { connection_id: hit.connectionId } });
    if (res.status === 200 && res.data?.profile) return setView({ name: "customer", profile: res.data.profile, via: "search" });
    setView({ name: "home" });
    setError(res.status === 0 ? L.scan.network : outcomeText(L, codeOf(res)));
  }

  function backToStart() {
    scanner.stop();
    setError(null);
    setTerm("");
    setHits(null);
    setView({ name: "home" });
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/${username}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the link is still shown as text */
    }
  }

  const cameraMessage =
    scanner.state === "denied"
      ? L.scan.camera.denied
      : scanner.state === "no_camera"
      ? L.scan.camera.none
      : scanner.state === "unsupported"
      ? L.scan.camera.unsupported
      : scanner.state === "insecure"
      ? L.scan.camera.insecure
      : null;

  if (view.name === "customer") {
    return (
      <CustomerLoyaltyCard
        profile={view.profile}
        via={view.via}
        can={can}
        templates={templates}
        onProfile={(profile) => setView({ name: "customer", profile, via: view.via })}
        onDone={backToStart}
      />
    );
  }

  if (view.name === "not_connected") {
    return (
      <div className="flex flex-col gap-4 rounded-card border border-amber-500/40 bg-amber-500/[0.06] p-5">
        <div className="flex items-start gap-3">
          <ShieldAlert className="mt-0.5 shrink-0 text-amber-600" size={22} />
          <div>
            <p className="text-base font-bold text-ringo-text">{L.scan.notConnected.title}</p>
            <p className="mt-1 text-sm text-ringo-muted">{L.scan.notConnected.body}</p>
          </div>
        </div>
        <div className="flex flex-col gap-2 rounded-xl bg-ringo-surface p-3 text-sm">
          <span className="text-xs font-semibold uppercase tracking-wide text-ringo-muted">{L.scan.notConnected.yourPage}</span>
          <div className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-medium text-ringo-text">/{username}</span>
            <button type="button" onClick={copyLink} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-ringo-border px-3 py-1.5 text-xs font-medium text-ringo-text">
              {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? L.scan.notConnected.copied : L.scan.notConnected.copyLink}
            </button>
          </div>
        </div>
        <button type="button" onClick={backToStart} className="self-start rounded-xl bg-ringo-indigo px-4 py-2.5 text-sm font-semibold text-white">
          {L.scan.scanAnother}
        </button>
      </div>
    );
  }

  const cameraOn = scanner.state === "scanning" || scanner.state === "starting";

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="rounded-xl bg-red-500/10 px-4 py-3 text-sm font-medium text-red-500">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
        {/* The <video> stays mounted so start() always has an element to attach the stream to. */}
        <div className={`relative overflow-hidden rounded-2xl bg-black ${cameraOn ? "aspect-square w-full" : "hidden"}`}>
          <video ref={scanner.videoRef} playsInline muted className="h-full w-full object-cover" />
          <canvas ref={scanner.canvasRef} className="hidden" />
          <div className="pointer-events-none absolute inset-[18%] rounded-2xl border-2 border-white/80" />
          <p className="absolute inset-x-0 bottom-3 px-4 text-center text-xs font-medium text-white drop-shadow">
            {scanner.state === "starting" ? L.scan.starting : L.scan.scanning}
          </p>
        </div>

        {view.name === "resolving" ? (
          <p className="flex items-center justify-center gap-2 py-4 text-sm text-ringo-muted">
            <Loader2 size={16} className="animate-spin" /> {L.scan.checking}
          </p>
        ) : cameraOn ? (
          <button type="button" onClick={scanner.stop} className="inline-flex items-center justify-center gap-2 rounded-xl border border-ringo-border px-4 py-3 text-sm font-semibold text-ringo-text">
            <X size={16} /> {L.scan.stopCamera}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                setError(null);
                scanner.start();
              }}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-ringo-indigo px-5 py-4 text-base font-bold text-white transition active:scale-[0.98]"
            >
              <Camera size={20} /> {L.scan.button}
            </button>
            <p className="text-center text-xs text-ringo-muted">{L.scan.hint}</p>
            {cameraMessage && (
              <div className="rounded-xl bg-amber-500/10 px-4 py-3 text-sm text-amber-700">
                <p>{cameraMessage}</p>
                {scanner.state !== "insecure" && scanner.state !== "unsupported" && (
                  <button type="button" onClick={() => scanner.start()} className="mt-2 text-xs font-semibold underline">
                    {L.scan.camera.retry}
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </section>

      <div className="flex items-center gap-3 text-xs uppercase tracking-wide text-ringo-muted">
        <span className="h-px flex-1 bg-ringo-border/70" />
        {L.scan.or}
        <span className="h-px flex-1 bg-ringo-border/70" />
      </div>

      <section className="flex flex-col gap-3 rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
        <h2 className="text-sm font-semibold text-ringo-text">{L.scan.searchTitle}</h2>
        <div className="relative">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ringo-muted" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder={L.scan.searchPlaceholder}
            aria-label={L.scan.searchTitle}
            autoComplete="off"
            className="w-full rounded-xl border border-ringo-border bg-ringo-bg py-2.5 pl-9 pr-3 text-sm text-ringo-text focus:outline-none focus:ring-2 focus:ring-ringo-indigo/30"
          />
        </div>
        <p className="text-xs text-ringo-muted">{L.scan.searchHint}</p>
        {searching && (
          <p className="flex items-center gap-2 text-sm text-ringo-muted">
            <Loader2 size={14} className="animate-spin" /> {L.scan.searching}
          </p>
        )}
        {!searching && hits && hits.length === 0 && <p className="text-sm text-ringo-muted">{L.scan.noResults}</p>}
        {hits && hits.length > 0 && (
          <ul className="flex flex-col divide-y divide-ringo-border/50">
            {hits.map((h) => (
              <li key={h.connectionId}>
                <button type="button" onClick={() => openHit(h)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-ringo-text">{h.name}</span>
                    <span className="block truncate text-xs text-ringo-muted">{[h.emailHint, h.phoneHint].filter(Boolean).join(" · ")}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
