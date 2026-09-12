"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getReferralCode } from "@/lib/referral";
import { Check, ArrowLeft } from "lucide-react";
import AuthShell from "@/components/auth/AuthShell";
import FormField from "@/components/auth/FormField";
import SubmitButton from "@/components/auth/SubmitButton";
import FormBanner from "@/components/auth/FormBanner";
import CategoryPicker from "@/components/CategoryPicker";
import type { CategoryId } from "@/lib/categories";

type UsernameStatus = "idle" | "checking" | "available" | "taken" | "invalid";

export default function SignupPage() {
  // This page doesn't use the app's i18n system (it's English-only by
  // design, unlike /get-started) — CategoryPicker still needs a locale to
  // pick which language to render its labels in, so it's hardcoded here.
  const [step, setStep] = useState<"category" | "form">("category");
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [extraCategories, setExtraCategories] = useState<CategoryId[]>([]);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [referralCode, setReferralCode] = useState("");
  const [referralPrefilled, setReferralPrefilled] = useState(false);
  const supabase = createClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  // Pre-fills from whatever ?ref=CODE was captured earlier (see
  // src/lib/referral.ts) when this person's own affiliate link brought
  // them here — still a plain editable field either way, so someone who
  // was just told a code by a friend (no link involved) can type it in
  // themselves.
  useEffect(() => {
    const stored = getReferralCode();
    if (stored) {
      setReferralCode(stored);
      setReferralPrefilled(true);
    }
  }, []);

  useEffect(() => {
    if (!username) {
      setUsernameStatus("idle");
      return;
    }
    if (username.length < 3) {
      setUsernameStatus("invalid");
      return;
    }

    setUsernameStatus("checking");
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("id").eq("username", username).maybeSingle();
      setUsernameStatus(data ? "taken" : "available");
    }, 400);

    return () => clearTimeout(debounceRef.current);
  }, [username]);

  const passwordStrength = password.length >= 10 ? "strong" : password.length >= 6 ? "ok" : "weak";

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // This is a fast UX check, not the source of truth — the database
    // trigger enforces uniqueness atomically at account-creation time.
    if (usernameStatus !== "available") {
      setError("Choose an available username before continuing.");
      return;
    }
    if (!agreed) {
      setError("You'll need to agree to the terms to continue.");
      return;
    }

    setLoading(true);

    const ref = referralCode.trim();

    const { error: signUpError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        // Read by the handle_new_auth_user trigger (username) and the
        // affiliate system's attribute_referral trigger (ref) — see
        // supabase/migrations/2026-09-06_affiliate_system.sql. category/
        // categories aren't read by that trigger — they're applied to the
        // profile once a session exists, from /auth/confirm (see there for
        // why: RLS needs auth.uid(), which isn't set until the email is
        // confirmed).
        data: {
          username,
          ...(ref ? { ref } : {}),
          ...(category ? { category, categories: [category, ...extraCategories] } : {}),
        },
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });

    setLoading(false);

    if (signUpError) {
      // Supabase wraps trigger failures in a generic message rather than
      // passing our raw exception text through — so we match on what it
      // typically says, and fall back to the real message otherwise.
      if (/database error/i.test(signUpError.message)) {
        setError("That username was just taken, or something went wrong. Try a different username.");
      } else if (/already registered|already exists/i.test(signUpError.message)) {
        setError("An account with that email already exists. Try logging in instead.");
      } else {
        setError(signUpError.message);
      }
      return;
    }

    setSent(true);
  };

  if (sent) {
    return (
      <AuthShell
        eyebrow="Almost there"
        title="Check your email"
        subtitle="One last step before your page goes live."
      >
        <FormBanner type="success">
          We sent a confirmation link to <strong>{email}</strong>. Click it to activate your
          account — then come back and log in.
        </FormBanner>
        <p className="text-sm text-ringo-muted mt-4">
          Didn't get it? Check spam, or{" "}
          <button
            onClick={async () => {
              await supabase.auth.resend({ type: "signup", email });
            }}
            className="text-ringo-indigo font-medium hover:underline"
          >
            resend the email
          </button>
          .
        </p>
        <Link
          href="/auth/login"
          className="block text-center text-sm text-ringo-indigo font-medium hover:underline mt-6"
        >
          Back to log in
        </Link>
      </AuthShell>
    );
  }

  if (step === "category") {
    return (
      <AuthShell
        eyebrow="Get started"
        title="What's your page for?"
        subtitle="Pick what best describes you — this personalizes your page's defaults. You can change it any time, and add more later."
      >
        <CategoryPicker
          locale="en"
          primary={category}
          onSelectPrimary={setCategory}
          extra={extraCategories}
          onToggleExtra={(id) =>
            setExtraCategories((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
          }
          strings={{
            morePrompt: "+ Add more categories (optional)",
            moreHint: "Your page fits more than one? Select as many as apply.",
          }}
        />

        <div className="flex flex-col gap-3 mt-6">
          <button
            onClick={() => setStep("form")}
            disabled={!category}
            className="py-3 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-40"
          >
            Continue
          </button>
          <button
            onClick={() => setStep("form")}
            className="text-sm text-ringo-muted hover:text-ringo-text transition-colors"
          >
            Skip — I'll choose later
          </button>
        </div>

        <p className="text-sm text-ringo-muted text-center mt-6">
          Already have a page?{" "}
          <Link href="/auth/login" className="text-ringo-indigo font-medium hover:underline">
            Log in
          </Link>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow="Get started"
      title="Create your page"
      subtitle="Free to start — upgrade any time as you grow."
    >
      <form onSubmit={handleSignup} noValidate>
        {error && <FormBanner type="error">{error}</FormBanner>}

        <button
          type="button"
          onClick={() => setStep("category")}
          className="flex items-center gap-1.5 text-sm text-ringo-muted mb-4"
        >
          <ArrowLeft size={15} />
          Back
        </button>

        <div className="mb-4">
          <label className="block">
            <span className="text-sm font-medium text-ringo-text">Username</span>
            <div className="relative mt-1.5">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-ringo-muted">
                ringoconnectltd.com/
              </span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                required
                placeholder="yourname"
                className={`w-full rounded-card border bg-ringo-surface pl-[9.6rem] pr-9 py-2.5 text-sm text-ringo-text outline-none transition focus:ring-2 focus:ring-ringo-indigo/40 ${
                  usernameStatus === "taken" || usernameStatus === "invalid"
                    ? "border-red-500"
                    : usernameStatus === "available"
                    ? "border-ringo-teal"
                    : "border-ringo-border focus:border-ringo-indigo"
                }`}
              />
              {usernameStatus === "checking" && (
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-ringo-muted">…</span>
              )}
              {usernameStatus === "available" && (
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-ringo-teal text-xs">✓</span>
              )}
            </div>
          </label>
          {usernameStatus === "taken" && (
            <p className="mt-1 text-xs text-red-500">That username is already taken.</p>
          )}
          {usernameStatus === "invalid" && username.length > 0 && (
            <p className="mt-1 text-xs text-red-500">Username needs at least 3 characters.</p>
          )}
        </div>

        <FormField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
          placeholder="you@example.com"
        />

        <div>
          <FormField
            label="Password"
            type="password"
            value={password}
            onChange={setPassword}
            autoComplete="new-password"
            placeholder="At least 6 characters"
          />
          {password.length > 0 && (
            <div className="-mt-3 mb-4 flex gap-1">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`h-1 flex-1 rounded-full ${
                    (passwordStrength === "weak" && i === 0) ||
                    (passwordStrength === "ok" && i <= 1) ||
                    passwordStrength === "strong"
                      ? passwordStrength === "strong"
                        ? "bg-ringo-teal"
                        : "bg-ringo-coral"
                      : "bg-ringo-border"
                  }`}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mb-4">
          <label className="block">
            <span className="text-sm font-medium text-ringo-text">Referral code (optional)</span>
            <div className="relative mt-1.5">
              <input
                type="text"
                value={referralCode}
                onChange={(e) => {
                  setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40));
                  setReferralPrefilled(false);
                }}
                placeholder="Have a code? Enter it here"
                className={`w-full rounded-card border bg-ringo-surface px-3.5 py-2.5 pr-9 text-sm text-ringo-text placeholder:text-ringo-muted/60 outline-none transition focus:ring-2 focus:ring-ringo-indigo/40 ${
                  referralPrefilled ? "border-ringo-teal" : "border-ringo-border focus:border-ringo-indigo"
                }`}
              />
              {referralPrefilled && (
                <Check size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-ringo-teal" />
              )}
            </div>
          </label>
          {referralPrefilled && (
            <p className="mt-1 text-xs text-ringo-teal">Applied from your referral link.</p>
          )}
        </div>

        <label className="flex items-start gap-2 mb-6 text-xs text-ringo-muted">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="mt-0.5 accent-ringo-indigo"
          />
          <span>
            I agree to Ringo Connect's{" "}
            <Link href="/terms" className="text-ringo-indigo hover:underline">
              Terms
            </Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-ringo-indigo hover:underline">
              Privacy Policy
            </Link>
            .
          </span>
        </label>

        <SubmitButton loading={loading} loadingText="Creating your page…">
          Create account
        </SubmitButton>
      </form>

      <p className="text-sm text-ringo-muted text-center mt-6">
        Already have a page?{" "}
        <Link href="/auth/login" className="text-ringo-indigo font-medium hover:underline">
          Log in
        </Link>
      </p>
    </AuthShell>
  );
}