"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { FcGoogle } from "react-icons/fc";
import { FaApple } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";
import { createClient } from "@/lib/supabase/client";
import FormBanner from "@/components/auth/FormBanner";
import { enabledProviders, isOAuthErrorKey, safeInviteToken, type OAuthProvider } from "@/lib/auth/oauthLogin";

// "Continue with Google / Apple" for the Log in page, under the email form. It sits below the existing form behind a
// quiet divider so the email-and-password path stays first and unchanged. OAuth here only SIGNS IN people who already
// have a Ringo account (the callback refuses anyone else); it never starts a signup. Words come from the
// translation system even though the surrounding page is English-only. Apple is hidden until
// NEXT_PUBLIC_APPLE_LOGIN_ENABLED === "true".
export default function OAuthButtons() {
  const { t } = useLanguage();
  const c = t.oauthLogin;
  const searchParams = useSearchParams();
  const [busy, setBusy] = useState<OAuthProvider | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  const invite = safeInviteToken(searchParams.get("invite"));
  const urlError = searchParams.get("oauth_error");
  const message = unavailable ? c.providerUnavailable : isOAuthErrorKey(urlError) ? (c as Record<string, string>)[urlError === "no_account" ? "noAccount" : urlError] : null;

  // Coming back with the browser's Back button restores this page as it was left (spinner on): reset it.
  useEffect(() => {
    const onShow = (e: PageTransitionEvent) => {
      if (e.persisted) setBusy(null);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  const start = async (provider: OAuthProvider) => {
    if (busy) return;
    setBusy(provider);
    setUnavailable(false);
    const redirectTo = `${window.location.origin}/auth/callback${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
    const { error } = await createClient().auth.signInWithOAuth({
      provider,
      options: { redirectTo, ...(provider === "apple" ? { scopes: "name email" } : {}) },
    });
    // On success the browser is already navigating to the provider; an error here means the provider is not set up.
    if (error) {
      setBusy(null);
      setUnavailable(true);
    }
  };

  const base =
    "w-full min-h-[44px] flex items-center justify-center gap-2.5 rounded-card px-4 py-2.5 text-sm font-medium transition disabled:opacity-60 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-indigo";
  const styles: Record<OAuthProvider, string> = {
    google: "bg-white text-[#1F1F1F] border border-[#DADCE0] hover:bg-[#F8F9FA]",
    apple: "bg-black text-white border border-black hover:bg-[#1A1A1A]",
  };

  return (
    <div className="mt-6" role="group" aria-label={c.groupLabel}>
      {message && <FormBanner type="error">{message}</FormBanner>}
      <div className="flex items-center gap-3 mb-4" aria-hidden="true">
        <span className="h-px flex-1 bg-ringo-border/70" />
        <span className="text-xs text-ringo-muted">{c.divider}</span>
        <span className="h-px flex-1 bg-ringo-border/70" />
      </div>
      <div className="flex flex-col gap-3">
        {enabledProviders(process.env.NEXT_PUBLIC_APPLE_LOGIN_ENABLED).map((provider) => (
          <button
            key={provider}
            type="button"
            onClick={() => void start(provider)}
            disabled={busy !== null}
            aria-busy={busy === provider}
            className={`${base} ${styles[provider]}`}
          >
            {busy === provider ? (
              <Loader2 size={18} className="animate-spin" aria-hidden="true" />
            ) : provider === "google" ? (
              <FcGoogle size={20} aria-hidden="true" />
            ) : (
              <FaApple size={20} aria-hidden="true" />
            )}
            {busy === provider ? c.redirecting : provider === "google" ? c.continueGoogle : c.continueApple}
          </button>
        ))}
      </div>
    </div>
  );
}
