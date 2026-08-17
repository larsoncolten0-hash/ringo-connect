"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/auth/AuthShell";
import FormField from "@/components/auth/FormField";
import SubmitButton from "@/components/auth/SubmitButton";
import FormBanner from "@/components/auth/FormBanner";

function ResetPasswordInner() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  // Two different link shapes can land here, depending on how the
  // recovery email was generated:
  //  - implicit/token_hash flow: Supabase signs the user in itself and
  //    fires PASSWORD_RECOVERY (or a session is already present by the
  //    time we mount, e.g. coming from /auth/confirm's verifyOtp call).
  //  - PKCE flow (GoTrue's default {{ .ConfirmationURL }} template):
  //    lands here with a bare ?code=... that still has to be exchanged
  //    for a session ourselves — the client's automatic
  //    detectSessionInUrl handling doesn't reliably fire
  //    PASSWORD_RECOVERY for this shape, so without this the page just
  //    sees "no session" and calls a perfectly valid code "expired".
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setSessionReady(true);
        setCheckingSession(false);
      }
    });

    const code = searchParams.get("code");
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ data, error }) => {
        if (!error && data.session) setSessionReady(true);
        setCheckingSession(false);
      });
    } else {
      // In case the event already fired before this listener mounted, or
      // the link simply isn't valid — give it a moment before concluding
      // either way.
      supabase.auth.getSession().then(({ data }) => {
        if (data.session) setSessionReady(true);
        setCheckingSession(false);
      });
    }
    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    if (password.length < 6) {
      setError("Password needs at least 6 characters.");
      return;
    }

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSuccess(true);
    setTimeout(() => router.push("/auth/login"), 2000);
  };

  return (
    <AuthShell
      eyebrow="Reset password"
      title="Set a new password"
      subtitle="Make it something you haven't used before."
    >
      {checkingSession ? (
        <p className="text-sm text-ringo-muted">Checking your reset link…</p>
      ) : !sessionReady && !success ? (
        <FormBanner type="error">
          This reset link is invalid or has expired. Request a new one from the forgot password page.
        </FormBanner>
      ) : success ? (
        <FormBanner type="success">Password updated. Redirecting you to log in…</FormBanner>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          {error && <FormBanner type="error">{error}</FormBanner>}

          <FormField
            label="New password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            placeholder="At least 6 characters"
          />
          <FormField
            label="Confirm new password"
            type="password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
            placeholder="Re-enter your password"
          />

          <SubmitButton loading={loading} loadingText="Updating…">
            Update password
          </SubmitButton>
        </form>
      )}
    </AuthShell>
  );
}

// useSearchParams requires a Suspense boundary in the App Router
export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
