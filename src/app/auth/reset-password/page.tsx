"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/auth/AuthShell";
import FormField from "@/components/auth/FormField";
import SubmitButton from "@/components/auth/SubmitButton";
import FormBanner from "@/components/auth/FormBanner";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  // Supabase's password-recovery link signs the user in via a token in the
  // URL fragment and fires this event once the session is ready.
  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setSessionReady(true);
        setCheckingSession(false);
      }
    });
    // In case the event already fired before this listener mounted, or the
    // link simply isn't valid — give it a moment before concluding either way.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setSessionReady(true);
      setCheckingSession(false);
    });
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
