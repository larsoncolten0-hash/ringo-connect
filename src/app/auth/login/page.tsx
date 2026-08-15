"use client";

import { useState, useEffect, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";
import FormField from "@/components/auth/FormField";
import SubmitButton from "@/components/auth/SubmitButton";
import FormBanner from "@/components/auth/FormBanner";

function LoginForm() {
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [needsConfirmation, setNeedsConfirmation] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const errParam = searchParams.get("error");
    if (errParam === "confirmation_failed") {
      setError("That confirmation link is invalid or has expired. Log in to request a new one, or enter your email or username below to resend it.");
      setNeedsConfirmation(true);
    } else if (errParam === "profile_missing") {
      setError("We couldn't find your profile. If you just signed up, confirm your email first — otherwise contact support.");
    }
  }, [searchParams]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setNeedsConfirmation(false);
    setLoading(true);

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier, password }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      if (data.error === "unconfirmed") {
        setError("Confirm your email before logging in — check your inbox for the link.");
        setNeedsConfirmation(true);
      } else if (data.error === "suspended") {
        setError("This account has been suspended. Contact support for help.");
      } else {
        setError("That email/username and password don't match an account.");
      }
      return;
    }

    router.push(data.role === "admin" ? "/admin" : "/dashboard");
    router.refresh();
  };

  const handleResend = async () => {
    if (!identifier) {
      setError("Enter your email or username above first, then resend.");
      return;
    }
    await fetch("/api/auth/resend-confirmation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ identifier }),
    });
    setResendSent(true);
  };

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Log in to Ringo Connect"
      subtitle="Manage your links, catalog, and WhatsApp button."
    >
      <form onSubmit={handleLogin} noValidate>
        {error && <FormBanner type="error">{error}</FormBanner>}
        {resendSent && <FormBanner type="success">Confirmation email resent — check your inbox.</FormBanner>}

        <FormField
          label="Email or username"
          type="text"
          value={identifier}
          onChange={setIdentifier}
          autoComplete="username"
          placeholder="you@example.com or yourname"
        />
        <div>
          <FormField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            placeholder="••••••••"
          />
          <div className="-mt-3 mb-4 text-right">
            <Link href="/auth/forgot-password" className="text-xs text-ringo-indigo hover:underline">
              Forgot password?
            </Link>
          </div>
        </div>

        {needsConfirmation && (
          <button
            type="button"
            onClick={handleResend}
            className="w-full text-sm text-ringo-indigo font-medium hover:underline mb-4"
          >
            Resend confirmation email
          </button>
        )}

        <SubmitButton loading={loading} loadingText="Logging in…">
          Log in
        </SubmitButton>
      </form>

      <p className="text-sm text-ringo-muted text-center mt-6">
        Don't have a page yet?{" "}
        <Link href="/auth/signup" className="text-ringo-indigo font-medium hover:underline">
          Create one
        </Link>
      </p>
    </AuthShell>
  );
}

// useSearchParams needs a Suspense boundary in the App Router
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}