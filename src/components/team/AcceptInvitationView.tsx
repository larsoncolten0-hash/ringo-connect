"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/auth/AuthShell";
import FormBanner from "@/components/auth/FormBanner";

type InvitationStatus = "pending" | "expired" | "revoked" | "cancelled" | "accepted" | "not_found";

const ACCEPT_ERROR_MESSAGES: Record<string, string> = {
  not_found: "This invitation link doesn't exist.",
  expired: "This invitation is no longer valid.",
  revoked: "This invitation is no longer available.",
  cancelled: "This invitation is no longer available.",
  already_used: "This invitation has already been used.",
  is_owner: "You already own this organization.",
  not_authenticated: "Sign in first, then try joining again.",
};

// The whole employee-facing side of both invitation methods lands here —
// see the product spec's "EMPLOYEE OPENS LINK" section. Deliberately one
// component regardless of method: a manual invitation and a link
// invitation produce the exact same organization_invitations row (see
// POST /api/team/invitations), so there is nothing method-specific left to
// branch on by the time someone opens this page.
export default function AcceptInvitationView({
  token,
  status,
  organizationName,
  roleName,
}: {
  token: string;
  status: InvitationStatus;
  organizationName: string | null;
  roleName: string | null;
}) {
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

  const join = async () => {
    setAccepting(true);
    setError("");
    try {
      const res = await fetch("/api/team/invitations/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "server_error");

      // Best-effort — makes the new organization active right away so the
      // dashboard redirect below opens straight into it. Never blocks the
      // success flow if it fails (the person can still switch manually).
      await fetch("/api/team/switch-org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: data.profileId }),
      }).catch(() => {});

      setAccepted(true);
      setTimeout(() => router.push("/dashboard"), 1200);
    } catch (err: any) {
      setError(ACCEPT_ERROR_MESSAGES[err?.message] || "Something went wrong — try again.");
    } finally {
      setAccepting(false);
    }
  };

  if (status === "not_found") {
    return <StatusScreen eyebrow="Invitation" title="Invitation not found" subtitle="This invitation link doesn't exist. Ask the organization for a new one." />;
  }
  if (status === "expired") {
    return <StatusScreen eyebrow="Invitation expired" title="This invitation is no longer valid" subtitle="Ask the organization administrator for a new invitation." />;
  }
  if (status === "revoked" || status === "cancelled") {
    return <StatusScreen eyebrow="Invitation revoked" title="This invitation is no longer available" subtitle="Ask the organization administrator for a new invitation." />;
  }
  if (status === "accepted" && !accepted) {
    return (
      <StatusScreen eyebrow="Already used" title="Invitation already used" subtitle="Please sign in to Ringo Connect.">
        <Link href="/auth/login" className="text-sm font-medium text-ringo-indigo hover:underline">
          Log in →
        </Link>
      </StatusScreen>
    );
  }

  return (
    <AuthShell eyebrow={organizationName || "Team invitation"} title="You're invited to join the team" subtitle={roleName ? `Role: ${roleName}` : ""}>
      {accepted ? (
        <FormBanner type="success">Welcome to {organizationName}! Taking you to your dashboard…</FormBanner>
      ) : (
        <>
          {error && <FormBanner type="error">{error}</FormBanner>}
          {checkingAuth ? (
            <div className="flex items-center gap-2 text-sm text-ringo-muted py-2">
              <Loader2 size={15} className="animate-spin" />
              Checking your account…
            </div>
          ) : authed ? (
            <button
              onClick={join}
              disabled={accepting}
              className="w-full flex items-center justify-center gap-2 rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5 transition hover:bg-ringo-indigo/90 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {accepting && <Loader2 size={15} className="animate-spin" />}
              {accepting ? "Joining…" : `Join ${organizationName}`}
            </button>
          ) : (
            <div className="flex flex-col gap-3">
              <Link
                href={`/auth/signup?invite=${token}`}
                className="w-full text-center rounded-card bg-ringo-indigo text-white text-sm font-medium py-2.5 transition hover:bg-ringo-indigo/90"
              >
                Create a Ringo account
              </Link>
              <Link
                href={`/auth/login?invite=${token}`}
                className="w-full text-center rounded-card border border-ringo-border text-sm font-medium py-2.5 text-ringo-text transition hover:bg-ringo-muted/10"
              >
                I already have an account — Log in
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
