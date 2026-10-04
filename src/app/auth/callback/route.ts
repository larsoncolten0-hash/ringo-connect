import { NextResponse } from "next/server";
import type { User } from "@supabase/supabase-js";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { loadAccountAccess } from "@/lib/auth/accountAccess";
import { removeStrayOAuthUser } from "@/lib/auth/removeStrayOAuthUser";
import { hasEmailIdentity, oauthErrorFromParams, resolveDestination, safeInviteToken, sameOriginRedirect, type OAuthErrorKey } from "@/lib/auth/oauthLogin";

// Where "Continue with Google / Apple" returns to (Supabase's /auth/v1/callback sends the browser here with a
// PKCE `code`). OAuth only AUTHENTICATES: this route lets in a person who already has a Ringo account and turns
// everyone else away at the Log in page. It never creates or edits an account or profile; its only delete is the
// guarded removal of the refused person's own just-created stray account.
//
//  1. a provider / Supabase error (cancelled, refused, "Database error saving new user") -> Log in, with a key;
//  2. the code is exchanged for a session (cookies are set by the cookie-aware server client);
//  3. the person must already have a Ringo email identity (Supabase links a provider to an existing account only
//     when the provider verified the same email). A person who exists ONLY because of this OAuth sign-in is not an
//     existing account: their session is ended and they are told so;
//     That refused person's account is a stray (Supabase had to create it to sign them in): once the session is ended,
//     the one guarded helper removes it if, and only if, it is brand new, OAuth-only, empty and has no payment record
//     (lib/auth/removeStrayOAuthUser.ts). Best-effort: it can never change what the person sees;
//  4. the same suspended / missing-account check the email login uses (lib/auth/accountAccess);
//  5. the same destination rules as the email login: a pending invitation, else a validated `next`, else the
//     role's home. `next` and `invite` are validated, so this can never become an open redirect.
export const dynamic = "force-dynamic";

// Best-effort and isolated: even if the service-role client cannot be made (missing env), the refusal still goes out.
async function cleanUpStray(user: User) {
  try {
    await removeStrayOAuthUser(createAdminClient(), user);
  } catch (err) {
    console.error("oauth stray cleanup could not start:", err instanceof Error ? err.message : "unknown error");
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const invite = safeInviteToken(params.get("invite"));

  const toLogin = (key: OAuthErrorKey) => {
    const q = new URLSearchParams({ oauth_error: key });
    if (invite) q.set("invite", invite);
    return NextResponse.redirect(new URL(`/auth/login?${q.toString()}`, url.origin));
  };

  const providerError = oauthErrorFromParams(params);
  if (providerError) return toLogin(providerError);

  const code = params.get("code");
  if (!code) return toLogin("failed");

  const supabase = createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) return toLogin("failed");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return toLogin("failed");

  if (!hasEmailIdentity(user)) {
    await supabase.auth.signOut();
    await cleanUpStray(user);
    return toLogin("no_account");
  }

  const access = await loadAccountAccess(supabase, user.id);
  if (!access.found) {
    await supabase.auth.signOut();
    return toLogin("no_account");
  }
  if (access.suspended) {
    await supabase.auth.signOut();
    return toLogin("suspended");
  }

  return NextResponse.redirect(sameOriginRedirect(resolveDestination({ role: access.role, invite, next: params.get("next") }), url.origin));
}
