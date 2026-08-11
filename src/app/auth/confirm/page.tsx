"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { type EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/auth/AuthShell";
import FormBanner from "@/components/auth/FormBanner";

// Deliberately a client page, not a server Route Handler. Email link
// scanners (Outlook Safe Links, Gmail, corporate antivirus proxies) fetch
// confirmation links automatically to check for malware — they don't
// execute JavaScript. Verifying the token here, inside a useEffect that
// only runs in a real browser, means those automated fetches can't
// consume the one-time token before the person actually clicks it.
function ConfirmInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const supabase = createClient();
  const [status, setStatus] = useState<"verifying" | "error">("verifying");

  useEffect(() => {
    const token_hash = searchParams.get("token_hash");
    const type = searchParams.get("type") as EmailOtpType | null;

    if (!token_hash || !type) {
      setStatus("error");
      return;
    }

    supabase.auth.verifyOtp({ token_hash, type }).then(({ error }) => {
      if (error) {
        setStatus("error");
      } else {
        router.replace("/auth/confirmed");
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "verifying") {
    return (
      <AuthShell
        eyebrow="Almost there"
        title="Confirming your email"
        subtitle="This only takes a second."
      >
        <p className="text-sm text-ringo-muted">Verifying your link…</p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="One more step"
      title="Confirmation link invalid"
      subtitle="This can happen if the link already expired or was already used."
    >
      <FormBanner type="error">
        This confirmation link is invalid or has expired.
      </FormBanner>
      <a
        href="/auth/login?error=confirmation_failed"
        className="block text-center text-sm text-ringo-indigo font-medium hover:underline mt-4"
      >
        Back to log in — you can resend the confirmation email there
      </a>
    </AuthShell>
  );
}

// useSearchParams requires a Suspense boundary in the App Router
export default function ConfirmPage() {
  return (
    <Suspense fallback={null}>
      <ConfirmInner />
    </Suspense>
  );
}