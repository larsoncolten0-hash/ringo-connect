"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import AuthShell from "@/components/auth/AuthShell";
import FormBanner from "@/components/auth/FormBanner";

type InvitationStatus = "pending" | "expired" | "revoked" | "cancelled" | "accepted" | "not_found";

export default function AcceptPartnerInvitationView({
  token,
  status,
  associationName,
}: {
  token: string;
  status: InvitationStatus;
  associationName: string | null;
}) {
  const { t } = useLanguage();
  const a = t.association;
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [authed, setAuthed] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setAuthed(!!data.user);
      setCheckingAuth(false);
    });
  }, []);

  const errorMessages: Record<string, string> = {
    not_found: a.invite.errorNotFound,
    revoked: a.invite.errorRevoked,
    cancelled: a.invite.errorRevoked,
    already_used: a.invite.errorAlreadyUsed,
    wrong_account: a.invite.errorWrongAccount,
    not_authenticated: a.invite.errorNotAuthenticated,
    association_disabled: a.invite.errorAssociationDisabled,
    partners_full: a.invite.errorPartnersFull,
    expired: a.invite.errorExpired,
  };

  const join = async () => {
    setAccepting(true);
    setError("");
    try {
      const res = await fetch("/api/association/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "server_error");
      setAccepted(true);
      setTimeout(() => router.push("/dashboard/association"), 1200);
    } catch (err: any) {
      setError(errorMessages[err?.message] || a.genericError);
    } finally {
      setAccepting(false);
    }
  };

  if (status === "not_found") return <StatusScreen eyebrow={a.invite.eyebrow} title={a.invite.notFoundTitle} subtitle={a.invite.errorNotFound} />;
  if (status === "expired") return <StatusScreen eyebrow={a.invite.eyebrow} title={a.invite.expiredTitle} subtitle={a.invite.errorExpired} />;
  if (status === "revoked" || status === "cancelled") return <StatusScreen eyebrow={a.invite.eyebrow} title={a.invite.revokedTitle} subtitle={a.invite.errorRevoked} />;
  if (status === "accepted" && !accepted) {
    return (
      <StatusScreen eyebrow={a.invite.eyebrow} title={a.invite.alreadyUsedTitle} subtitle={a.invite.loginPrompt}>
        <Link href="/auth/login" className="text-sm font-medium text-ringo-indigo hover:underline">
          {a.invite.loginLink}
        </Link>
      </StatusScreen>
    );
  }

  return (
    <AuthShell eyebrow={associationName || a.invite.eyebrow} title={a.invite.title(associationName || "")} subtitle="">
      {accepted ? (
        <FormBanner type="success">{a.invite.acceptedMessage(associationName || "")}</FormBanner>
      ) : (
        <>
          {error && <FormBanner type="error">{error}</FormBanner>}
          {checkingAuth ? (
            <div className="flex items-center gap-2 text-sm text-ringo-muted py-2">
              <Loader2 size={15} className="animate-spin" />
              {a.invite.checkingAccount}
            </div>
          ) : authed ? (
            <button
              onClick={join}
              disabled={accepting}
              className="w-full flex items-center justify-center gap-2 rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5 transition hover:bg-ringo-indigo/90 disabled:opacity-60"
            >
              {accepting && <Loader2 size={15} className="animate-spin" />}
              {accepting ? a.invite.joining : a.invite.joinCta(associationName || "")}
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <Link href="/auth/login" className="w-full text-center rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5 transition hover:bg-ringo-indigo/90">
                {a.invite.loginLink}
              </Link>
            </div>
          )}
        </>
      )}
    </AuthShell>
  );
}

function StatusScreen({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <AuthShell eyebrow={eyebrow} title={title} subtitle={subtitle}>
      {children}
    </AuthShell>
  );
}
