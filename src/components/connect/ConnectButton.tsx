"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, Plus } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { hexToRgba } from "@/lib/color";
import StayConnectedModal from "./StayConnectedModal";

type Status = "loading" | "out" | "connected";

// "＋ Connect" — the universal customer ↔ profile action on a public Ringo
// profile. Always shown — Community is always on (src/lib/community/enabled.ts)
// and Connect never depends on profiles.community_enabled. The state comes from
// the customer session cookie via /api/customer/me, so it survives
// refreshes and new tabs — no localStorage involved, and the profile page
// itself stays cacheable.
//
//   signed in            -> one tap: POST /api/customer/connect
//   not signed in        -> "Stay Connected" modal (name/phone/email + code)
//   already connected    -> "✓ Connected", opens the notifications state
//
// `preview` (dashboard live preview) renders an inert button: no fetch, no
// click behaviour.
//
// `variant` only changes how it LOOKS - every state, request and the modal are the same in all three:
//   "card"    - the original titled box (the default);
//   "compact" - one centred pill, for sitting just under the hero;
//   "primary" - one full-width button, for a profile that has no other action to offer.
// Connect is RINGO's own action on a creator's page, so while it is still to be done it is always Ringo indigo (#4F46E5, white text), the
// one filled action on the page: elevated, tactile, and with a single soft ring that breathes outward every few seconds (never continuous;
// off under reduced motion). Once connected it settles into a calm outlined state in the creator's own colours.
export default function ConnectButton({
  profile,
  accent,
  radiusClass,
  buttonStyle,
  borderTint,
  textColor,
  preview = false,
  variant = "card",
}: {
  profile: { id: string; name: string };
  accent: string;
  radiusClass: string;
  buttonStyle: React.CSSProperties;
  borderTint: string;
  textColor: string;
  preview?: boolean;
  variant?: "card" | "compact" | "primary";
}) {
  const { t } = useLanguage();
  const [status, setStatus] = useState<Status>(preview ? "out" : "loading");
  const [authenticated, setAuthenticated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [modal, setModal] = useState<null | "form" | "done">(null);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    const load = () =>
      fetch(`/api/customer/me?profile_id=${encodeURIComponent(profile.id)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((d) => {
          if (cancelled) return;
          setAuthenticated(d?.authenticated === true);
          setStatus(d?.connected === true ? "connected" : "out");
        })
        .catch(() => !cancelled && setStatus("out"));
    load();
    // Re-check when the page is shown again from the back/forward cache or the tab regains
    // focus: after disconnecting in My Ringo and coming back to this profile, the button must
    // show "Connect" again instead of a stale "Connected".
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) load();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("pageshow", onShow);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("pageshow", onShow);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [profile.id, preview]);

  const onClick = async () => {
    if (preview || busy || status === "loading") return;
    setError("");

    if (status === "connected") return setModal("done");
    if (!authenticated) return setModal("form");

    setBusy(true);
    try {
      const res = await fetch("/api/customer/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: profile.id }),
      });
      if (res.status === 401) {
        // Session expired since the page loaded — fall back to the form.
        setAuthenticated(false);
        return setModal("form");
      }
      if (!res.ok) return setError(t.connect.genericError);
      setStatus("connected");
      setModal("done");
    } catch {
      setError(t.connect.genericError);
    } finally {
      setBusy(false);
    }
  };

  const isConnected = status === "connected";
  const shape = variant === "compact" ? "inline-flex min-h-[48px] px-7 rounded-full" : variant === "primary" ? "flex w-full min-h-[52px] px-6 rounded-full" : "inline-flex min-h-[48px] px-7 rounded-full";
  const buttonClass = `ringo-tactile ${shape} items-center justify-center gap-2 text-[15px] font-semibold ${isConnected ? "" : "ringo-cta ringo-cta--attention"}`;
  const buttonLook: React.CSSProperties = isConnected
    ? { border: `1px solid ${borderTint}`, color: textColor, backgroundColor: hexToRgba(textColor, 0.04) }
    : { border: "1px solid rgb(165 180 252 / 0.45)" };

  const button = (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-busy={busy || status === "loading"}
      aria-live="polite"
      className={buttonClass}
      style={buttonLook}
    >
      {busy ? (
        <Loader2 size={16} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : isConnected ? (
        <Check size={16} aria-hidden="true" />
      ) : (
        <Plus size={16} aria-hidden="true" />
      )}
      {busy ? t.connect.connecting : status === "connected" ? t.connect.connectedButton : t.connect.connectButton}
    </button>
  );

  const errorNote = error && (
    <p role="alert" className="text-xs mt-2 text-red-600">
      {error}
    </p>
  );

  const modalNode = !preview && modal && (
    <StayConnectedModal
      open
      onClose={() => setModal(null)}
      profile={profile}
      accent={accent}
      initialStep={modal === "done" ? "done" : "form"}
      onConnected={() => {
        setAuthenticated(true);
        setStatus("connected");
      }}
    />
  );

  if (variant !== "card") {
    return (
      <div className={variant === "compact" ? "flex flex-col items-center" : "w-full"}>
        {button}
        {errorNote}
        {modalNode}
      </div>
    );
  }

  return (
    <div
      className={`text-center p-5 ${radiusClass}`}
      style={{ border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.03) }}
    >
      <p className="text-[11px] uppercase tracking-wider font-semibold" style={{ opacity: 0.5 }}>
        {t.connect.sectionTitle}
      </p>
      <p className="text-sm mt-1.5 mb-4" style={{ opacity: 0.75 }}>
        {t.connect.sectionSubtitle(profile.name)}
      </p>
      {button}
      {errorNote}
      {modalNode}
    </div>
  );
}
