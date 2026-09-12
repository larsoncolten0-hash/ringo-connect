"use client";

import { useEffect, useRef, useState } from "react";
import {
  Nfc,
  Check,
  X,
  Loader2,
  ExternalLink,
  ChevronRight,
  RotateCcw,
  HelpCircle,
  ShieldAlert,
} from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getCategory } from "@/lib/categories";
import RingoCardVisual from "@/components/dashboard/RingoCardVisual";
import RingoCardDiagnostics from "@/components/dashboard/RingoCardDiagnostics";
import {
  isWebNfcSupported,
  isSecureContextAvailable,
  isLikelyAndroid,
  writeRingoCardUrl,
  readRingoCard,
  RingoCardError,
  type RingoCardErrorCode,
} from "@/lib/ringoCardWriter";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type RingoCardStatus = "available" | "assigned" | "active" | "lost" | "disabled" | "replaced";

export interface RingoCardRow {
  id: string;
  card_reference: string;
  status: RingoCardStatus;
  destination_url: string | null;
  profile_id: string | null;
  card_uid: string | null;
  card_type: string;
  assigned_at: string | null;
  last_written_at: string | null;
  last_verified_at: string | null;
  created_at: string;
  profiles?: { username: string; name: string | null } | null;
}

interface ProfileLite {
  id: string;
  username: string;
  name: string | null;
  category: string | null;
  categories: string[] | null;
  about_location: string | null;
  published: boolean;
}

// The wizard's current step. `flow` carries what a select/ready/writing
// step needs to know: whether we're assigning a brand-new card or
// rewriting an existing one, and (once created) the ringo_cards row id so
// a retry never creates a second row for the same physical card.
type Stage = "home" | "select" | "ready" | "success" | "error";
type Flow = { mode: "new" | "rewrite"; cardId: string | null; card?: RingoCardRow };

type ErrorKey = RingoCardErrorCode | "server";

export default function RingoCardWriter({
  profile,
  siteUrl,
  initialCards,
}: {
  profile: ProfileLite;
  siteUrl: string;
  initialCards: RingoCardRow[];
}) {
  const { t, locale } = useLanguage();
  const c = t.ringoCard;

  const [cards, setCards] = useState<RingoCardRow[]>(initialCards);
  const [stage, setStage] = useState<Stage>("home");
  const [flow, setFlow] = useState<Flow | null>(null);
  const [busy, setBusy] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorKey, setErrorKey] = useState<ErrorKey | null>(null);
  const [successCard, setSuccessCard] = useState<RingoCardRow | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [verifyState, setVerifyState] = useState<"idle" | "checking" | "ok" | "mismatch" | "failed">("idle");

  // null = not checked yet (first render, before the client-only check
  // below runs) — treated as "assume supported" only for a single paint
  // to avoid a hydration mismatch; the real device wins immediately after.
  const [nfcSupported, setNfcSupported] = useState<boolean | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setNfcSupported(isWebNfcSupported() && isSecureContextAvailable());
  }, []);

  // Cancels any in-flight write if the creator navigates away mid-flow —
  // Web NFC has no automatic cleanup of its own.
  useEffect(() => () => abortRef.current?.abort(), []);

  const destinationUrl = `${siteUrl.replace(/\/$/, "")}/${profile.username}`;
  const categoryLabel = getCategory(profile.category)?.label[locale];
  const subtitleParts = [categoryLabel, profile.about_location].filter(Boolean);

  const updateCard = (updated: RingoCardRow) =>
    setCards((prev) => {
      const exists = prev.some((card) => card.id === updated.id);
      return exists ? prev.map((card) => (card.id === updated.id ? { ...card, ...updated } : card)) : [updated, ...prev];
    });

  const errorMessage = (key: ErrorKey): string => (c.errors as Record<string, string>)[key] || c.errors.generic;

  // -------------------------------------------------------------------
  // Flow control
  // -------------------------------------------------------------------
  const startNewCard = () => {
    setFlow({ mode: "new", cardId: null });
    setErrorKey(null);
    setStage("select");
  };

  const startRewrite = (card: RingoCardRow) => {
    setFlow({ mode: "rewrite", cardId: card.id, card });
    setErrorKey(null);
    setStage("select");
  };

  const resumeWriting = (card: RingoCardRow) => {
    // A card that was assigned but never successfully written (e.g. the
    // creator navigated away mid-tap) — resume straight at "bring your
    // card close" rather than making them re-pick a profile.
    setFlow({ mode: "new", cardId: card.id, card });
    setErrorKey(null);
    setStage("ready");
  };

  const goHome = () => {
    setFlow(null);
    setErrorKey(null);
    setStage("home");
  };

  const confirmSelection = () => setStage("ready");

  const handleWrite = async () => {
    if (busy || !flow) return;
    setBusy(true);
    setErrorKey(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      let cardId = flow.cardId;

      if (!cardId) {
        setStatusMessage(c.statusPreparing);
        const res = await fetch("/api/ringo-cards", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ profileId: profile.id }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.card) throw new RingoCardError("unknown", json.error || "server");
        cardId = json.card.id;
        updateCard(json.card);
        setFlow((f) => (f ? { ...f, cardId } : f));
      }

      // Web NFC's write() call itself blocks until a physical tag is
      // presented, then writes it in the same operation — there's no
      // separate "tag found" event to react to, so a single status
      // message covers the whole wait-and-write window.
      setStatusMessage(c.statusWriting);
      await writeRingoCardUrl(destinationUrl, controller.signal);

      const commitRes = await fetch(`/api/ringo-cards/${cardId}/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id }),
      });
      const commitJson = await commitRes.json().catch(() => ({}));
      if (!commitRes.ok || !commitJson.card) throw new RingoCardError("unknown", commitJson.error || "server");

      updateCard(commitJson.card);
      setSuccessCard(commitJson.card);
      setVerifyState("idle");
      setFlow(null);
      setStage("success");
    } catch (err) {
      setErrorKey(err instanceof RingoCardError ? err.code : "server");
      setStage("error");
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const handleReadCard = async (card: RingoCardRow) => {
    if (verifyState === "checking") return;
    setVerifyState("checking");
    try {
      const result = await readRingoCard(15000);
      const normalize = (u: string | null) => (u || "").replace(/\/$/, "");
      const matches = !!result.url && normalize(result.url) === normalize(card.destination_url);

      const res = await fetch(`/api/ringo-cards/${card.id}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardUid: result.serialNumber || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.card) updateCard(json.card);
      if (card.id === successCard?.id && json.card) setSuccessCard(json.card);

      setVerifyState(matches ? "ok" : "mismatch");
    } catch {
      setVerifyState("failed");
    }
  };

  const testCard = (card: RingoCardRow) => {
    if (card.destination_url) window.open(card.destination_url, "_blank", "noopener,noreferrer");
  };

  // -------------------------------------------------------------------
  // Shared bits
  // -------------------------------------------------------------------
  const Header = () => (
    <div className="mb-6">
      <div className="flex items-center gap-2.5 mb-1">
        <span className="w-8 h-8 rounded-xl bg-ringo-indigo/10 flex items-center justify-center shrink-0">
          <Nfc size={16} className="text-ringo-indigo" strokeWidth={2.25} />
        </span>
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">{c.pageTitle}</h1>
      </div>
      <p className="text-sm text-ringo-muted">{c.pageSubtitle}</p>
    </div>
  );

  const ProfilePreview = () => (
    <div className="rounded-card border border-ringo-border/70 bg-ringo-bg p-4 flex flex-col gap-1">
      <p className="text-base font-semibold text-ringo-text uppercase tracking-[-0.01em]">
        {profile.name || profile.username}
      </p>
      {subtitleParts.length > 0 && <p className="text-xs text-ringo-muted">{subtitleParts.join(" • ")}</p>}
      <div className="mt-2 pt-2 border-t border-ringo-border/50">
        <p className="text-[11px] text-ringo-muted mb-0.5">{c.yourRingoProfile}</p>
        <p className="text-sm font-mono text-ringo-indigo break-all">{destinationUrl.replace(/^https?:\/\//, "")}</p>
      </div>
    </div>
  );

  const statusBadgeClass = (status: RingoCardStatus) =>
    status === "active"
      ? "bg-ringo-teal/10 text-ringo-teal"
      : status === "assigned"
      ? "bg-ringo-indigo/10 text-ringo-indigo"
      : status === "lost" || status === "disabled"
      ? "bg-ringo-coral/10 text-ringo-coral"
      : "bg-ringo-muted/10 text-ringo-muted";

  const isStale = (card: RingoCardRow) =>
    card.status === "active" && !!card.destination_url && card.destination_url.replace(/\/$/, "") !== destinationUrl.replace(/\/$/, "");

  // -------------------------------------------------------------------
  // Home
  // -------------------------------------------------------------------
  if (stage === "home") {
    return (
      <div className="max-w-2xl">
        <Header />
        <div className="flex flex-col gap-5">
          <ProfilePreview />

          <button
            onClick={startNewCard}
            className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-card bg-ringo-indigo text-white text-sm font-semibold transition hover:brightness-110 active:scale-[0.98]"
          >
            <Nfc size={16} />
            {cards.length > 0 ? c.writeNewCta : c.writeCta}
          </button>

          <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5">
            <h2 className="text-sm font-semibold text-ringo-text mb-3">{c.myCardsTitle}</h2>

            {cards.length === 0 ? (
              <p className="text-xs text-ringo-muted">{c.myCardsEmpty}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {cards.map((card) => (
                  <div key={card.id} className="rounded-card border border-ringo-border/60 p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ringo-text font-mono truncate">{card.card_reference}</p>
                        <p className="text-xs text-ringo-muted truncate mt-0.5">
                          {card.profiles?.name || card.profiles?.username || "—"}
                        </p>
                      </div>
                      <span className={`shrink-0 text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 rounded-full ${statusBadgeClass(card.status)}`}>
                        {c.statusLabels[card.status]}
                      </span>
                    </div>

                    {isStale(card) && <p className="text-[11px] text-ringo-coral mt-2">{c.staleUrlHint}</p>}

                    <div className="flex flex-wrap gap-2 mt-3">
                      {card.status === "assigned" && (
                        <button
                          onClick={() => resumeWriting(card)}
                          className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white font-medium hover:brightness-110 transition"
                        >
                          {c.finishWritingAction}
                        </button>
                      )}
                      {card.status === "active" && (
                        <>
                          <button
                            onClick={() => testCard(card)}
                            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition"
                          >
                            <ExternalLink size={12} /> {c.testCta}
                          </button>
                          <button
                            onClick={() => startRewrite(card)}
                            className="text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition"
                          >
                            {c.rewriteAction}
                          </button>
                        </>
                      )}
                    </div>

                    <div className="mt-3">
                      <RingoCardDiagnostics
                        cardReference={card.card_reference}
                        destinationUrl={card.destination_url}
                        cardUid={card.card_uid}
                        hasBeenWritten={!!card.last_written_at}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // Select profile
  // -------------------------------------------------------------------
  if (stage === "select" && flow) {
    return (
      <div className="max-w-2xl">
        <BackBar onBack={goHome} />
        <h1 className="font-display text-xl font-medium text-ringo-text mb-1">{c.selectTitle}</h1>
        <p className="text-sm text-ringo-muted mb-5">{c.selectSubtitle}</p>

        {flow.mode === "rewrite" && flow.card && (
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="rounded-card border border-ringo-border/70 bg-ringo-bg p-3.5">
              <p className="text-[10px] uppercase tracking-wide text-ringo-muted mb-1">{c.rewriteCurrentLabel}</p>
              <p className="text-sm font-semibold text-ringo-text truncate">{flow.card.profiles?.name || flow.card.profiles?.username || "—"}</p>
            </div>
            <div className="rounded-card border border-ringo-indigo/40 bg-ringo-indigo/5 p-3.5">
              <p className="text-[10px] uppercase tracking-wide text-ringo-indigo mb-1">{c.rewriteNewLabel}</p>
              <p className="text-sm font-semibold text-ringo-text truncate">{profile.name || profile.username}</p>
            </div>
          </div>
        )}

        {/* Only one Ringo profile exists per account today, so this is a
            single, pre-selected option — the picker still renders (rather
            than being skipped entirely) so the architecture already
            supports multiple profiles per creator without a UI rewrite. */}
        <label className="flex items-center gap-3 rounded-card border-2 border-ringo-indigo bg-ringo-indigo/5 p-4 cursor-default mb-5">
          <input type="radio" checked readOnly className="accent-ringo-indigo w-4 h-4 shrink-0" />
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-ringo-text uppercase truncate">{profile.name || profile.username}</span>
            <span className="block text-xs text-ringo-muted truncate font-mono">{destinationUrl.replace(/^https?:\/\//, "")}</span>
          </span>
        </label>

        {flow.mode === "rewrite" && <p className="text-xs text-ringo-muted mb-5">{c.rewriteHint}</p>}

        <button
          onClick={confirmSelection}
          className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-card bg-ringo-indigo text-white text-sm font-semibold transition hover:brightness-110 active:scale-[0.98]"
        >
          {c.continueCta} <ChevronRight size={16} />
        </button>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // Ready / writing
  // -------------------------------------------------------------------
  if (stage === "ready" && flow) {
    const unsupported = nfcSupported === false;

    return (
      <div className="max-w-2xl">
        <BackBar onBack={goHome} />

        {unsupported ? (
          <UnsupportedPanel
            c={c}
            isDesktop={!isLikelyAndroid()}
            onHowItWorks={() => setShowHowItWorks(true)}
            showHowItWorks={showHowItWorks}
            onHide={() => setShowHowItWorks(false)}
            onBack={goHome}
          />
        ) : (
          <>
            <h1 className="font-display text-xl font-medium text-ringo-text mb-1 text-center">
              {flow.mode === "rewrite" ? c.rewriteCta : c.readyTitle}
            </h1>
            <p className="text-sm text-ringo-muted mb-2 text-center">{c.readySubtitle}</p>

            <RingoCardVisual pulsing={busy} />

            <div aria-live="polite" className="text-center text-sm font-medium text-ringo-indigo h-5 mb-4">
              {busy ? statusMessage : ""}
            </div>

            <button
              onClick={handleWrite}
              disabled={busy}
              className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-card bg-ringo-indigo text-white text-sm font-semibold transition hover:brightness-110 active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Nfc size={16} />}
              {flow.mode === "rewrite" ? c.confirmAndWriteCta : c.writeCta}
            </button>

            <button
              onClick={() => setShowHelp((v) => !v)}
              className="w-full text-center text-xs text-ringo-muted hover:text-ringo-text transition mt-5 flex items-center justify-center gap-1"
            >
              <HelpCircle size={13} /> {c.troubleTitle}
            </button>
            {showHelp && (
              <ul className="mt-3 flex flex-col gap-1.5 text-xs text-ringo-muted list-disc list-inside">
                {c.troubleReasons.map((reason: string) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------
  // Success
  // -------------------------------------------------------------------
  if (stage === "success" && successCard) {
    return (
      <div className="max-w-2xl">
        <div className="flex flex-col items-center text-center py-4">
          <span className="w-14 h-14 rounded-full bg-ringo-teal/10 flex items-center justify-center mb-4">
            <Check size={26} className="text-ringo-teal" strokeWidth={2.5} />
          </span>
          <h1 className="font-display text-xl font-semibold text-ringo-text mb-1">{c.successTitle}</h1>
          <p className="text-sm text-ringo-muted mb-1">{c.successSubtitle}</p>
          <p className="text-xs text-ringo-muted mb-6">{c.successHint}</p>

          <div className="w-full rounded-card border border-ringo-border/70 bg-ringo-bg p-4 text-left mb-6">
            <p className="text-sm font-semibold text-ringo-text uppercase mb-2">{profile.name || profile.username}</p>
            <Row label={c.verifyDestination} value={destinationUrl.replace(/^https?:\/\//, "")} />
            <Row label={c.verifyStatus} value={c.verifyReady} />
            <Row
              label={c.verifyConnected}
              value={verifyState === "ok" ? `✓ ${c.verifyConnected}` : verifyState === "checking" ? c.statusVerifying : c.verifyNotYetRead}
            />
          </div>

          <div className="w-full flex flex-col sm:flex-row gap-2 mb-3">
            <button
              onClick={() => testCard(successCard)}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-3 rounded-card bg-ringo-indigo text-white text-sm font-semibold hover:brightness-110 transition"
            >
              <ExternalLink size={15} /> {c.testCta}
            </button>
            <button
              onClick={() => handleReadCard(successCard)}
              disabled={verifyState === "checking"}
              className="flex-1 flex items-center justify-center gap-1.5 px-4 py-3 rounded-card border border-ringo-border text-ringo-text text-sm font-medium hover:border-ringo-indigo hover:text-ringo-indigo transition disabled:opacity-60"
            >
              {verifyState === "checking" ? <Loader2 size={15} className="animate-spin" /> : <Nfc size={15} />}
              {c.readCardCta}
            </button>
          </div>

          <button onClick={startNewCard} className="text-sm text-ringo-muted hover:text-ringo-indigo transition flex items-center gap-1.5">
            <RotateCcw size={13} /> {c.writeAnotherCta}
          </button>

          <div className="w-full mt-6">
            <RingoCardDiagnostics
              cardReference={successCard.card_reference}
              destinationUrl={successCard.destination_url}
              cardUid={successCard.card_uid}
              hasBeenWritten={!!successCard.last_written_at}
            />
          </div>
        </div>
      </div>
    );
  }

  // -------------------------------------------------------------------
  // Error
  // -------------------------------------------------------------------
  if (stage === "error" && errorKey) {
    return (
      <div className="max-w-2xl">
        <div className="flex flex-col items-center text-center py-6">
          <span className="w-14 h-14 rounded-full bg-ringo-coral/10 flex items-center justify-center mb-4">
            <ShieldAlert size={24} className="text-ringo-coral" strokeWidth={2.25} />
          </span>
          <h1 className="font-display text-lg font-semibold text-ringo-text mb-1">{errorMessage(errorKey)}</h1>
          {errorKey === "unsupported" && <p className="text-xs text-ringo-muted mb-4 max-w-xs">{c.errors.unsupportedHint}</p>}

          <div className="w-full flex flex-col sm:flex-row gap-2 mt-4">
            <button
              onClick={() => (flow ? setStage("ready") : goHome())}
              className="flex-1 px-4 py-3 rounded-card bg-ringo-indigo text-white text-sm font-semibold hover:brightness-110 transition"
            >
              {c.tryAgainCta}
            </button>
            <button
              onClick={() => setShowHowItWorks((v) => !v)}
              className="flex-1 px-4 py-3 rounded-card border border-ringo-border text-ringo-text text-sm font-medium hover:border-ringo-indigo hover:text-ringo-indigo transition"
            >
              {c.howItWorksCta}
            </button>
          </div>

          {showHowItWorks && <HowItWorksPanel c={c} />}

          <button onClick={goHome} className="text-xs text-ringo-muted hover:text-ringo-text transition mt-5">
            ← {c.pageTitle}
          </button>
        </div>
      </div>
    );
  }

  return null;
}

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------
function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-xs text-ringo-muted">{label}</span>
      <span className="text-xs font-medium text-ringo-text text-right break-all">{value}</span>
    </div>
  );
}

function BackBar({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="flex items-center gap-1 text-xs text-ringo-muted hover:text-ringo-text transition mb-4">
      <X size={13} /> Cancel
    </button>
  );
}

function UnsupportedPanel({
  c,
  isDesktop,
  showHowItWorks,
  onHowItWorks,
  onHide,
  onBack,
}: {
  c: any;
  isDesktop: boolean;
  showHowItWorks: boolean;
  onHowItWorks: () => void;
  onHide: () => void;
  onBack: () => void;
}) {
  return (
    <div className="flex flex-col items-center text-center py-6">
      <span className="w-14 h-14 rounded-full bg-ringo-coral/10 flex items-center justify-center mb-4">
        <ShieldAlert size={24} className="text-ringo-coral" strokeWidth={2.25} />
      </span>
      <h1 className="font-display text-lg font-semibold text-ringo-text mb-1">{c.errors.unsupported}</h1>
      <p className="text-xs text-ringo-muted mb-2 max-w-xs">{c.errors.unsupportedHint}</p>
      {isDesktop && <p className="text-xs text-ringo-muted mb-3 max-w-xs">{c.desktopNotice}</p>}

      <div className="w-full flex flex-col sm:flex-row gap-2 mt-3">
        <button onClick={onBack} className="flex-1 px-4 py-3 rounded-card bg-ringo-indigo text-white text-sm font-semibold hover:brightness-110 transition">
          {c.tryAgainCta}
        </button>
        <button
          onClick={showHowItWorks ? onHide : onHowItWorks}
          className="flex-1 px-4 py-3 rounded-card border border-ringo-border text-ringo-text text-sm font-medium hover:border-ringo-indigo hover:text-ringo-indigo transition"
        >
          {c.howItWorksCta}
        </button>
      </div>

      {showHowItWorks && <HowItWorksPanel c={c} />}
    </div>
  );
}

function HowItWorksPanel({ c }: { c: any }) {
  return (
    <div className="w-full rounded-card border border-ringo-border/70 bg-ringo-bg p-4 mt-4 text-left">
      <p className="text-sm font-semibold text-ringo-text mb-2">{c.tagline}</p>
      <ol className="text-xs text-ringo-muted flex flex-col gap-1.5 list-decimal list-inside">
        {c.howItWorksSteps.map((step: string) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
    </div>
  );
}
