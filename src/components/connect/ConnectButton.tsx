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
export default function ConnectButton({
  profile,
  accent,
  radiusClass,
  buttonStyle,
  borderTint,
  textColor,
  preview = false,
}: {
  profile: { id: string; name: string };
  accent: string;
  radiusClass: string;
  buttonStyle: React.CSSProperties;
  borderTint: string;
  textColor: string;
  preview?: boolean;
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
      <button
        type="button"
        onClick={onClick}
        disabled={status === "loading" || busy}
        aria-live="polite"
        className={`inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium transition hover:brightness-95 active:scale-[0.98] disabled:opacity-70 ${radiusClass}`}
        style={buttonStyle}
      >
        {busy || status === "loading" ? (
          <Loader2 size={15} className="animate-spin" />
        ) : status === "connected" ? (
          <Check size={15} />
        ) : (
          <Plus size={15} />
        )}
        {busy ? t.connect.connecting : status === "connected" ? t.connect.connectedButton : t.connect.connectButton}
      </button>
      {error && (
        <p role="alert" className="text-xs mt-2 text-red-600">
          {error}
        </p>
      )}

      {!preview && modal && (
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
      )}
    </div>
  );
}
