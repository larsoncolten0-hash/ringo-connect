// Customer Follow-Up (admin) — turns raw, read-only rows from the existing tables into ONE row per
// customer with each lifecycle fact kept SEPARATE (account, registration payment, approval,
// subscription, PWA install, push, attribution). Pure and server-safe: no database access, no
// network, no writes — the loader (customerFollowUpData.ts) supplies the rows; tests pass fixtures.
//
// Two rules run through everything here:
//  * NEVER GUESS. Attribution comes only from authoritative rows (ambassador_sales, the request's
//    own ambassador/referral code, users.referred_by). Anything else is "unassigned". PWA status is
//    "installed" only on a positive signal; the absence of an event is never "not installed".
//  * The facts are not interchangeable: a registration payment is not an approval, an approval is
//    not an active subscription, a push subscription is not an installed app.

export type RequestRow = {
  id: string;
  full_name: string | null;
  whatsapp_number: string | null;
  email: string | null;
  status: string; // 'pending' | 'approved' | 'rejected'
  customer_paid: boolean | null;
  pending_fapshi_trans_id: string | null;
  created_user_id: string | null;
  referral_code: string | null;
  source: string | null; // 'get_started' | 'affiliate'
  ambassador_code: string | null;
  requested_plan_id: string | null;
  created_at: string;
};
export type UserRow = {
  id: string;
  email: string | null;
  role: string | null;
  plan_id: string | null;
  status: string | null; // 'active' | 'suspended'
  created_at: string;
  plan_expires_at: string | null;
  referred_by: string | null;
  affiliate_code: string | null;
  last_active_at: string | null;
  last_active_standalone: boolean | null;
  pwa_installed_at: string | null;
};
export type ProfileRow = { id: string; user_id: string | null; name: string | null; username: string | null };
export type PhoneRow = { profile_id: string; phone_number: string | null; sort_order: number | null };
export type PlanRow = { id: string; name: string };
export type SaleRow = { signup_request_id: string | null; ambassador_id: string | null; team_id: string | null; customer_user_id: string | null };
export type AmbassadorProfileRow = { id: string; user_id: string; team_id: string | null; sales_code: string | null };
export type TeamRow = { id: string; team_leader_user_id: string; name: string | null };
export type PushSubRow = { user_id: string | null; user_agent: string | null };
export type FollowUpStatus = "needs_follow_up" | "completed";
export type FollowUpRecord = {
  subject_type: "request" | "user";
  subject_id: string;
  status: FollowUpStatus;
  follow_up_date: string | null;
  assigned_to: string | null;
  note: string | null;
  updated_at: string | null;
};
export type StaffRow = { id: string; email: string | null };

export type FollowUpInput = {
  requests: RequestRow[];
  users: UserRow[];
  profiles: ProfileRow[];
  phones: PhoneRow[];
  plans: PlanRow[];
  sales: SaleRow[];
  ambassadorProfiles: AmbassadorProfileRow[];
  teams: TeamRow[];
  pushSubs: PushSubRow[];
  followUps: FollowUpRecord[];
  staff: StaffRow[];
  /** Demo/test accounts — never real customers. */
  testUserIds?: Set<string>;
  now?: Date;
};

export type AccountStatus = "no_account" | "awaiting_approval" | "rejected" | "active" | "suspended";
export type PaymentStatus = "paid" | "not_recorded" | "payment_started" | "awaiting_payment" | "not_required" | "unknown";
export type SubscriptionStatus = "none" | "free" | "active" | "expired";
export type PwaStatus = "installed" | "not_installed" | "unknown" | "not_detectable";
export type RegistrationSource = "get_started" | "affiliate" | "unknown";

export type Attribution =
  | { kind: "ambassador"; via: "sale" | "code"; ambassadorName: string; teamLeaderName: string | null; teamName: string | null }
  | { kind: "affiliate"; affiliateName: string }
  | { kind: "unassigned" };

export type FollowUpRow = {
  key: string;
  subjectType: "request" | "user";
  subjectId: string;
  name: string;
  email: string;
  phone: string;
  registeredAt: string;
  hasAccount: boolean;
  accountStatus: AccountStatus;
  paymentStatus: PaymentStatus;
  planName: string | null;
  subscriptionStatus: SubscriptionStatus;
  planExpiresAt: string | null;
  pwa: PwaStatus;
  /** Why the PWA status is what it is — shown in the details view. */
  pwaReason: "confirmed_install_event" | "confirmed_standalone_use" | "ios_cannot_detect" | "no_signal" | "no_account";
  pushSubscribed: boolean;
  lastSeenAt: string | null;
  registrationSource: RegistrationSource;
  attribution: Attribution;
  followUp: {
    status: FollowUpStatus;
    date: string | null;
    assigneeId: string | null;
    assigneeLabel: string | null;
    note: string | null;
  } | null;
};

const IOS_UA = /iPhone|iPad|iPod/i;

/**
 * Installed = a POSITIVE signal only: the browser's own `appinstalled` event (users.pwa_installed_at)
 * or the customer having opened Ringo in standalone display-mode (users.last_active_standalone).
 * There is deliberately no automatic "not installed": an installed app can still be opened in a
 * browser tab, and iOS Safari never fires `appinstalled`, so no event / a browser visit proves
 * nothing. "not_installed" is only returned when the caller passes a genuine current signal
 * (none exists today), so the status can never be produced by absence alone.
 */
export function classifyPwa(input: {
  hasAccount: boolean;
  pwaInstalledAt: string | null;
  lastActiveStandalone: boolean | null;
  pushUserAgents: string[];
  currentNotInstalledSignal?: boolean;
}): { status: PwaStatus; reason: FollowUpRow["pwaReason"] } {
  if (!input.hasAccount) return { status: "unknown", reason: "no_account" };
  if (input.pwaInstalledAt) return { status: "installed", reason: "confirmed_install_event" };
  if (input.lastActiveStandalone === true) return { status: "installed", reason: "confirmed_standalone_use" };
  if (input.currentNotInstalledSignal === true) return { status: "not_installed", reason: "no_signal" };
  if (input.pushUserAgents.some((ua) => IOS_UA.test(ua))) return { status: "not_detectable", reason: "ios_cannot_detect" };
  return { status: "unknown", reason: "no_signal" };
}

export function classifySubscription(planName: string | null, planExpiresAt: string | null, hasAccount: boolean, now: Date): SubscriptionStatus {
  if (!hasAccount || !planName) return "none";
  if (planName === "free") return "free";
  if (!planExpiresAt) return "active"; // paid plan with no expiry (e.g. granted by an admin)
  return new Date(planExpiresAt).getTime() > now.getTime() ? "active" : "expired";
}

function displayName(userId: string | null | undefined, users: Map<string, UserRow>, profilesByUser: Map<string, ProfileRow>): string {
  if (!userId) return "";
  const p = profilesByUser.get(userId);
  return p?.name || (p?.username ? `@${p.username}` : "") || users.get(userId)?.email || "";
}

export function buildFollowUpRows(input: FollowUpInput): FollowUpRow[] {
  const now = input.now ?? new Date();
  const test = input.testUserIds ?? new Set<string>();
  const usersById = new Map(input.users.map((u) => [u.id, u]));
  const profilesByUser = new Map<string, ProfileRow>();
  for (const p of input.profiles) if (p.user_id) profilesByUser.set(p.user_id, p);
  const phoneByProfile = new Map<string, string>();
  for (const ph of [...input.phones].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))) {
    if (ph.phone_number && !phoneByProfile.has(ph.profile_id)) phoneByProfile.set(ph.profile_id, ph.phone_number);
  }
  const plansById = new Map(input.plans.map((p) => [p.id, p.name]));
  const ambById = new Map(input.ambassadorProfiles.map((a) => [a.id, a]));
  const ambByCode = new Map<string, AmbassadorProfileRow>();
  for (const a of input.ambassadorProfiles) if (a.sales_code) ambByCode.set(a.sales_code.toLowerCase(), a);
  const teamsById = new Map(input.teams.map((t) => [t.id, t]));
  const saleByRequest = new Map<string, SaleRow>();
  const saleByCustomer = new Map<string, SaleRow>();
  for (const s of input.sales) {
    if (s.signup_request_id) saleByRequest.set(s.signup_request_id, s);
    if (s.customer_user_id) saleByCustomer.set(s.customer_user_id, s);
  }
  const affiliateByCode = new Map<string, UserRow>();
  for (const u of input.users) if (u.affiliate_code) affiliateByCode.set(u.affiliate_code.toLowerCase(), u);
  const pushByUser = new Map<string, string[]>();
  for (const s of input.pushSubs) {
    if (!s.user_id) continue;
    const list = pushByUser.get(s.user_id) ?? [];
    list.push(s.user_agent || "");
    pushByUser.set(s.user_id, list);
  }
  const followUpByKey = new Map<string, FollowUpRecord>();
  for (const f of input.followUps) followUpByKey.set(`${f.subject_type}:${f.subject_id}`, f);
  const staffById = new Map(input.staff.map((s) => [s.id, s.email || ""]));

  function attributionFor(req: RequestRow | null, userId: string | null): Attribution {
    // 1. Ambassador / Team Leader — the sale row is authoritative (it carries the team snapshot).
    const sale = (req && saleByRequest.get(req.id)) || (userId ? saleByCustomer.get(userId) : undefined);
    let amb: AmbassadorProfileRow | undefined;
    let via: "sale" | "code" = "sale";
    let teamId: string | null = null;
    if (sale?.ambassador_id) {
      amb = ambById.get(sale.ambassador_id);
      teamId = sale.team_id;
    } else if (req?.ambassador_code) {
      amb = ambByCode.get(req.ambassador_code.toLowerCase());
      via = "code";
      teamId = amb?.team_id ?? null;
    }
    if (amb) {
      const team = teamId ? teamsById.get(teamId) : undefined;
      return {
        kind: "ambassador",
        via,
        ambassadorName: displayName(amb.user_id, usersById, profilesByUser),
        teamLeaderName: team ? displayName(team.team_leader_user_id, usersById, profilesByUser) : null,
        teamName: team?.name ?? null,
      };
    }
    // 2. Affiliate referral — the request's own referral code, or the account's referred_by.
    const account = userId ? usersById.get(userId) : undefined;
    const affiliate = (req?.referral_code && affiliateByCode.get(req.referral_code.toLowerCase())) || (account?.referred_by ? usersById.get(account.referred_by) : undefined);
    if (affiliate) return { kind: "affiliate", affiliateName: displayName(affiliate.id, usersById, profilesByUser) };
    // 3. Anything else is unassigned — never inferred.
    return { kind: "unassigned" };
  }

  function build(req: RequestRow | null, user: UserRow | null): FollowUpRow {
    const subjectType = req ? "request" : "user";
    const subjectId = (req ? req.id : user!.id) as string;
    const profile = user ? profilesByUser.get(user.id) : undefined;
    const hasAccount = !!user;

    let accountStatus: AccountStatus;
    if (user) accountStatus = user.status === "suspended" ? "suspended" : "active";
    else if (req?.status === "rejected") accountStatus = "rejected";
    else if (req?.status === "pending") accountStatus = "awaiting_approval";
    else accountStatus = "no_account"; // approved but the account row is missing

    let paymentStatus: PaymentStatus = "unknown";
    if (req) {
      const requestedPlan = req.requested_plan_id ? plansById.get(req.requested_plan_id) : null;
      if (requestedPlan === "free") paymentStatus = "not_required";
      else if (req.customer_paid) paymentStatus = "paid";
      // Approved without a recorded online payment (e.g. approved after a cash payment): the
      // online payment was not "started" or "awaited" any more — say only what is on record.
      else if (req.status === "approved") paymentStatus = "not_recorded";
      else if (req.pending_fapshi_trans_id) paymentStatus = "payment_started";
      else paymentStatus = "awaiting_payment";
    }

    const planName = user?.plan_id ? plansById.get(user.plan_id) ?? null : null;
    const pushUas = user ? pushByUser.get(user.id) ?? [] : [];
    const pwa = classifyPwa({
      hasAccount,
      pwaInstalledAt: user?.pwa_installed_at ?? null,
      lastActiveStandalone: user?.last_active_standalone ?? null,
      pushUserAgents: pushUas,
    });

    const record = followUpByKey.get(`${subjectType}:${subjectId}`);
    const source: RegistrationSource = req ? (req.source === "affiliate" ? "affiliate" : "get_started") : "unknown";

    return {
      key: `${subjectType}:${subjectId}`,
      subjectType,
      subjectId,
      name: req?.full_name || profile?.name || (profile?.username ? `@${profile.username}` : "") || "",
      email: req?.email || user?.email || "",
      phone: req?.whatsapp_number || (profile ? phoneByProfile.get(profile.id) || "" : ""),
      registeredAt: req?.created_at || user!.created_at,
      hasAccount,
      accountStatus,
      paymentStatus,
      planName,
      subscriptionStatus: classifySubscription(planName, user?.plan_expires_at ?? null, hasAccount, now),
      planExpiresAt: user?.plan_expires_at ?? null,
      pwa: pwa.status,
      pwaReason: pwa.reason,
      pushSubscribed: pushUas.length > 0,
      lastSeenAt: user?.last_active_at ?? null,
      registrationSource: source,
      attribution: attributionFor(req, user?.id ?? null),
      followUp: record
        ? {
            status: record.status,
            date: record.follow_up_date,
            assigneeId: record.assigned_to,
            assigneeLabel: record.assigned_to ? staffById.get(record.assigned_to) || null : null,
            note: record.note,
          }
        : null,
    };
  }

  const rows: FollowUpRow[] = [];
  const usedUsers = new Set<string>();
  for (const req of input.requests) {
    const user = req.created_user_id ? usersById.get(req.created_user_id) ?? null : null;
    if (user && (test.has(user.id) || user.role === "admin")) continue;
    if (user) usedUsers.add(user.id);
    rows.push(build(req, user));
  }
  // Accounts with no signup request (created some other way) — their payment/source is unknown.
  for (const user of input.users) {
    if (usedUsers.has(user.id) || user.role === "admin" || test.has(user.id)) continue;
    rows.push(build(null, user));
  }
  return rows.sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
}

// --------------------------------------------------------------------------------------------
// Filters and summary

export type StageFilter =
  | "all"
  | "recent"
  | "awaiting_payment"
  | "paid_not_activated"
  | "awaiting_approval"
  | "subscription_active"
  | "subscription_expired"
  | "unassigned"
  | "needs_follow_up";
export type PwaFilter = "all" | "installed" | "none_confirmed" | "unknown";
export type FollowUpFilters = { q: string; stage: StageFilter; pwa: PwaFilter; from: string; to: string };

export const DEFAULT_FILTERS: FollowUpFilters = { q: "", stage: "all", pwa: "all", from: "", to: "" };
export const RECENT_DAYS = 7;

export const isAwaitingPayment = (r: FollowUpRow) => !r.hasAccount && r.accountStatus === "awaiting_approval" && (r.paymentStatus === "awaiting_payment" || r.paymentStatus === "payment_started");
export const isPaidNotActivated = (r: FollowUpRow) => !r.hasAccount && r.accountStatus === "awaiting_approval" && r.paymentStatus === "paid";
export const isUnassigned = (r: FollowUpRow) => r.attribution.kind === "unassigned";
export const needsFollowUp = (r: FollowUpRow) => r.followUp?.status === "needs_follow_up";

export function applyFilters(rows: FollowUpRow[], f: FollowUpFilters, now: Date = new Date()): FollowUpRow[] {
  const q = f.q.trim().toLowerCase();
  const qDigits = q.replace(/[^0-9]/g, "");
  const from = f.from ? new Date(`${f.from}T00:00:00`).getTime() : null;
  const to = f.to ? new Date(`${f.to}T23:59:59.999`).getTime() : null;
  const recentCutoff = now.getTime() - RECENT_DAYS * 86_400_000;
  return rows.filter((r) => {
    if (q) {
      const hay = `${r.name} ${r.email}`.toLowerCase();
      const phoneMatch = qDigits.length >= 3 && r.phone.replace(/[^0-9]/g, "").includes(qDigits);
      if (!hay.includes(q) && !phoneMatch) return false;
    }
    const t = new Date(r.registeredAt).getTime();
    if (from !== null && t < from) return false;
    if (to !== null && t > to) return false;
    switch (f.stage) {
      case "recent": if (t < recentCutoff) return false; break;
      case "awaiting_payment": if (!isAwaitingPayment(r)) return false; break;
      case "paid_not_activated": if (!isPaidNotActivated(r)) return false; break;
      case "awaiting_approval": if (!(r.accountStatus === "awaiting_approval")) return false; break;
      case "subscription_active": if (r.subscriptionStatus !== "active") return false; break;
      case "subscription_expired": if (r.subscriptionStatus !== "expired") return false; break;
      case "unassigned": if (!isUnassigned(r)) return false; break;
      case "needs_follow_up": if (!needsFollowUp(r)) return false; break;
    }
    switch (f.pwa) {
      case "installed": if (r.pwa !== "installed") return false; break;
      case "none_confirmed": if (r.pwa === "installed") return false; break;
      case "unknown": if (r.pwa !== "unknown") return false; break;
    }
    return true;
  });
}

export type FollowUpSummary = {
  total: number;
  awaitingPayment: number;
  paidNotActivated: number;
  awaitingApproval: number;
  activeAccounts: number;
  activeSubscriptions: number;
  expiredSubscriptions: number;
  pwaInstalled: number;
  pwaNoneConfirmed: number;
  pwaUnknown: number;
  pushSubscribed: number;
  unassigned: number;
  needsFollowUp: number;
};

export function summarize(rows: FollowUpRow[]): FollowUpSummary {
  const count = (fn: (r: FollowUpRow) => boolean) => rows.filter(fn).length;
  return {
    total: rows.length,
    awaitingPayment: count(isAwaitingPayment),
    paidNotActivated: count(isPaidNotActivated),
    awaitingApproval: count((r) => r.accountStatus === "awaiting_approval"),
    activeAccounts: count((r) => r.accountStatus === "active"),
    activeSubscriptions: count((r) => r.subscriptionStatus === "active"),
    expiredSubscriptions: count((r) => r.subscriptionStatus === "expired"),
    pwaInstalled: count((r) => r.pwa === "installed"),
    pwaNoneConfirmed: count((r) => r.hasAccount && r.pwa !== "installed"),
    pwaUnknown: count((r) => r.hasAccount && r.pwa === "unknown"),
    pushSubscribed: count((r) => r.pushSubscribed),
    unassigned: count(isUnassigned),
    needsFollowUp: count(needsFollowUp),
  };
}

// --------------------------------------------------------------------------------------------
// Follow-up write validation (used by the admin API route)

export type FollowUpUpdate = {
  subjectType: "request" | "user";
  subjectId: string;
  status: FollowUpStatus;
  followUpDate: string | null;
  assignedTo: string | null;
  note: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const NOTE_MAX = 500;

/** Validates an admin's follow-up update. Returns the clean value or a machine-readable error. */
export function parseFollowUpUpdate(body: unknown): { ok: true; value: FollowUpUpdate } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (b.subjectType !== "request" && b.subjectType !== "user") return { ok: false, error: "invalid_subject" };
  if (typeof b.subjectId !== "string" || !UUID.test(b.subjectId)) return { ok: false, error: "invalid_subject" };
  if (b.status !== "needs_follow_up" && b.status !== "completed") return { ok: false, error: "invalid_status" };
  let date: string | null = null;
  if (b.followUpDate != null && b.followUpDate !== "") {
    if (typeof b.followUpDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.followUpDate) || Number.isNaN(Date.parse(b.followUpDate))) return { ok: false, error: "invalid_date" };
    date = b.followUpDate;
  }
  let assignedTo: string | null = null;
  if (b.assignedTo != null && b.assignedTo !== "") {
    if (typeof b.assignedTo !== "string" || !UUID.test(b.assignedTo)) return { ok: false, error: "invalid_assignee" };
    assignedTo = b.assignedTo;
  }
  let note: string | null = null;
  if (b.note != null && b.note !== "") {
    if (typeof b.note !== "string") return { ok: false, error: "invalid_note" };
    note = b.note.trim().slice(0, NOTE_MAX) || null;
  }
  return { ok: true, value: { subjectType: b.subjectType, subjectId: b.subjectId, status: b.status, followUpDate: date, assignedTo, note } };
}
