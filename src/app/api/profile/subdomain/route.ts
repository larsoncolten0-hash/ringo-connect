import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { getProfileDomain, profileAddress, profileSubdomainAllowed, SUBDOMAIN_RESERVE_DAYS, validateSubdomain, type SubdomainErrorCode } from "@/lib/profileSubdomain";

// The owner's custom profile address (<name>.<profile domain>).
//
// Auth: the caller's own session. The profile is ALWAYS the one owned by the authenticated user (profiles.user_id = session user); a profile id or username sent by the
// browser is never read, so one customer can never read or change another customer's address.
// Plan: every operation (read, check, save) re-reads the caller's account from the database (users.status + the plan joined through users.plan_id, service role) and requires an
// active account on a PAID plan (profileSubdomainAllowed, which reuses isPaidPlan). Nothing about the plan comes from the request, and nothing is cached: a downgrade takes effect
// on the very next request. A downgrade never deletes the stored address (subscription controls ACCESS, not data), it just stops this API and the address itself from working.
// Storage: both tables are reachable only with the service role (RLS on, no policies). The write goes through claim_profile_subdomain(), one transaction that serializes
// concurrent requests (advisory locks), applies the rules (taken / impersonation / recently released) and retires the old name on a change. The availability check below is advisory;
// the function decides.
export const dynamic = "force-dynamic";

async function owner() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("id, username").eq("user_id", user.id).maybeSingle();
  if (!profile) return null;
  const { data: account } = await createAdminClient().from("users").select("status, plans(name)").eq("id", user.id).maybeSingle();
  return { profileId: profile.id as string, username: profile.username as string, paid: profileSubdomainAllowed(account as any) };
}

const fail = (code: SubdomainErrorCode, status = 400) => NextResponse.json({ ok: false, code }, { status });
const NOT_PAID = () => fail("plan_required", 403);

// Reserved + format are decided in lib/profileSubdomain.ts; this adds what only the database knows, for the advisory check: held by someone else, equal to ANOTHER profile's
// username, or released by someone else too recently.
async function availability(profileId: string, input: unknown): Promise<{ ok: true; subdomain: string } | { ok: false; code: SubdomainErrorCode }> {
  const v = validateSubdomain(input);
  if (!v.ok) return v;
  const admin = createAdminClient();
  const [{ data: held }, { data: sameUsername }, { data: retired }] = await Promise.all([
    admin.from("profile_subdomains").select("profile_id").eq("subdomain", v.subdomain).maybeSingle(),
    admin.from("profiles").select("id").eq("username", v.subdomain).maybeSingle(),
    admin.from("profile_subdomain_retired").select("profile_id, retired_until").eq("subdomain", v.subdomain).maybeSingle(),
  ]);
  if (held && held.profile_id !== profileId) return { ok: false, code: "taken" };
  if (sameUsername && sameUsername.id !== profileId) return { ok: false, code: "taken" };
  if (retired && retired.profile_id !== profileId && new Date(retired.retired_until as string).getTime() > Date.now()) return { ok: false, code: "recently_released" };
  return v;
}

export async function GET() {
  const me = await owner();
  if (!me) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const domain = getProfileDomain();
  if (!domain) return NextResponse.json({ enabled: false });
  if (!me.paid) return NextResponse.json({ enabled: true, allowed: false });
  const { data } = await createAdminClient().from("profile_subdomains").select("subdomain").eq("profile_id", me.profileId).maybeSingle();
  const subdomain = (data?.subdomain as string | undefined) ?? null;
  return NextResponse.json({ enabled: true, allowed: true, domain, subdomain, address: subdomain ? profileAddress(subdomain, domain) : null });
}

export async function POST(request: Request) {
  const me = await owner();
  if (!me) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
  const domain = getProfileDomain();
  if (!domain) return NextResponse.json({ ok: false, code: "disabled" }, { status: 404 });
  if (!me.paid) return NOT_PAID();

  const body = await request.json().catch(() => null);
  const action = body?.action;
  if (action !== "check" && action !== "save") return NextResponse.json({ error: "Invalid action." }, { status: 400 });

  const a = await availability(me.profileId, body?.subdomain);
  if (!a.ok) return fail(a.code);
  if (action === "check") return NextResponse.json({ ok: true, subdomain: a.subdomain, address: profileAddress(a.subdomain, domain) });

  const { data: outcome, error } = await createAdminClient().rpc("claim_profile_subdomain", {
    p_profile_id: me.profileId,
    p_subdomain: a.subdomain,
    p_reserve_days: SUBDOMAIN_RESERVE_DAYS,
  });
  if (error) {
    console.error("profile subdomain save failed:", error.message);
    return NextResponse.json({ error: "Could not save." }, { status: 500 });
  }
  if (outcome === "ok" || outcome === "unchanged") return NextResponse.json({ ok: true, subdomain: a.subdomain, address: profileAddress(a.subdomain, domain) });
  // The check above can pass and the function still say no: someone else saved the same name in between (taken), or released it a moment ago (recently_released).
  if (outcome === "taken") return fail("taken", 409);
  if (outcome === "recently_released") return fail("recently_released", 409);
  return fail("invalid_chars");
}
