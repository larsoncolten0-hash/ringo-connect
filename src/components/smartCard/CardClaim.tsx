"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Loader2, Nfc } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// The claim page for an UNCLAIMED Smart Card. Signed-out visitors are sent to sign in (and brought straight back here); only a signed-in owner can claim,
// and the server decides everything that matters: the browser sends the token and a profile id, the claim function checks that profile belongs to the session user.
type ProfileOption = { id: string; username: string; name: string | null };

export default function CardClaim({ token, serial, signedIn, profiles }: { token: string; serial: string; signedIn: boolean; profiles: ProfileOption[] }) {
  const { t } = useLanguage();
  const c = t.smartCard;
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [claimedUser, setClaimedUser] = useState<string | null>(null);

  const claim = async () => {
    if (busy || !profileId) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/smart-cards/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        referrerPolicy: "no-referrer",
        body: JSON.stringify({ token, profileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.username) {
        setClaimedUser(String(data.username));
      } else if (data?.error === "already_claimed") {
        setError(c.alreadyClaimed);
      } else if (data?.error === "profile_not_allowed") {
        setError(c.profileNotAllowed);
      } else if (res.status === 429) {
        setError(`${c.limitedTitle}. ${c.limitedBody}`);
      } else {
        setError(c.genericError);
      }
    } catch {
      setError(c.genericError);
    } finally {
      setBusy(false);
    }
  };

  const back = encodeURIComponent(`/c/${token}`);
  const shell = (children: React.ReactNode) => (
    <main className="flex min-h-screen items-center justify-center bg-[#FAFAF8] px-4 py-10">
      <div className="w-full max-w-sm rounded-3xl border border-ringo-border bg-white p-6 text-center shadow-sm">{children}</div>
    </main>
  );

  if (claimedUser) {
    return shell(
      <>
        <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600"><CheckCircle2 size={28} /></span>
        <h1 className="text-xl font-semibold text-ringo-text">{c.claimedTitle}</h1>
        <p className="mt-2 text-sm text-ringo-muted">{c.claimedBody}</p>
        <Link href={`/${encodeURIComponent(claimedUser)}`} className="mt-5 inline-flex h-12 w-full items-center justify-center rounded-full bg-ringo-indigo text-[15px] font-semibold text-white">{c.viewProfile}</Link>
      </>
    );
  }

  return shell(
    <>
      <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-ringo-indigo/10 text-ringo-indigo"><Nfc size={26} /></span>
      <h1 className="text-xl font-semibold text-ringo-text">{c.claimTitle}</h1>
      <p className="mt-2 text-sm text-ringo-muted">{c.claimIntro}</p>
      <p className="mt-3 text-xs font-medium uppercase tracking-[0.14em] text-ringo-muted">{c.cardLabel} <span className="text-ringo-text">{serial}</span></p>

      {!signedIn ? (
        <div className="mt-5 flex flex-col gap-2.5">
          <p className="text-sm text-ringo-muted">{c.signInFirst}</p>
          <Link href={`/auth/login?next=${back}`} className="inline-flex h-12 items-center justify-center rounded-full bg-ringo-indigo text-[15px] font-semibold text-white">{c.signIn}</Link>
          <Link href="/get-started" className="inline-flex h-12 items-center justify-center rounded-full border border-ringo-border text-[15px] font-semibold text-ringo-text">{c.createAccount}</Link>
        </div>
      ) : profiles.length === 0 ? (
        <p className="mt-5 text-sm text-ringo-muted">{c.noProfile}</p>
      ) : (
        <div className="mt-5 flex flex-col gap-3 text-left">
          <label className="text-sm text-ringo-muted" htmlFor="card-profile">{profiles.length > 1 ? c.choosePrompt : c.claimingAs}</label>
          <select id="card-profile" value={profileId} onChange={(e) => setProfileId(e.target.value)} className="h-12 rounded-xl border border-ringo-border bg-white px-3 text-[15px] text-ringo-text">
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name ? `${p.name} (@${p.username})` : `@${p.username}`}</option>
            ))}
          </select>
          {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          <button type="button" onClick={claim} disabled={busy || !profileId} className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-ringo-indigo text-[15px] font-semibold text-white disabled:opacity-60">
            {busy ? <><Loader2 size={16} className="animate-spin" />{c.claiming}</> : c.claimButton}
          </button>
        </div>
      )}
    </>
  );
}
