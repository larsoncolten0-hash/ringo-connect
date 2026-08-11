"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/auth/AuthShell";
import FormField from "@/components/auth/FormField";
import SubmitButton from "@/components/auth/SubmitButton";
import FormBanner from "@/components/auth/FormBanner";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const supabase = createClient();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/reset-password`,
    });

    setLoading(false);

    // Always show success, even if the email doesn't exist — avoids leaking
    // which addresses have accounts.
    if (resetError) {
      setError("Something went wrong sending the reset link. Try again.");
      return;
    }
    setSent(true);
  };

  return (
    <AuthShell
      eyebrow="Reset password"
      title="Forgot your password?"
      subtitle="We'll email you a link to set a new one."
    >
      {sent ? (
        <div>
          <FormBanner type="success">
            If an account exists for <strong>{email}</strong>, a reset link is on its way. Check your inbox.
          </FormBanner>
          <Link
            href="/auth/login"
            className="block text-center text-sm text-ringo-indigo font-medium hover:underline mt-4"
          >
            Back to log in
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          {error && <FormBanner type="error">{error}</FormBanner>}

          <FormField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="email"
            placeholder="you@example.com"
          />

          <SubmitButton loading={loading} loadingText="Sending link…">
            Send reset link
          </SubmitButton>

          <Link
            href="/auth/login"
            className="block text-center text-sm text-ringo-muted hover:text-ringo-text mt-4"
          >
            Back to log in
          </Link>
        </form>
      )}
    </AuthShell>
  );
}
