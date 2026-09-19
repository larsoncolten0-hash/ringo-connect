"use client";

import Link from "next/link";
import Image from "next/image";
import BrandLogo from "@/components/BrandLogo";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { LayoutGrid, BarChart3, CreditCard, Handshake, ClipboardCheck, QrCode, UtensilsCrossed, Music2, CalendarCheck, Users, ExternalLink, Ticket, Nfc, UserCog, AlertTriangle, Award, Gift } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";
import LanguageToggle from "@/components/LanguageToggle";
import NotificationBell from "@/components/NotificationBell";
import PushPermissionPrompt from "@/components/PushPermissionPrompt";
import AvatarMenu from "@/components/dashboard/AvatarMenu";
import HelpWidget from "@/components/dashboard/HelpWidget";
import MobileMoreMenu from "@/components/dashboard/MobileMoreMenu";
import PullToRefresh from "@/components/dashboard/PullToRefresh";
import RegisterServiceWorker from "@/components/RegisterServiceWorker";
import AppBadgeReset from "@/components/AppBadgeReset";
import ActivitySignals from "@/components/ActivitySignals";
import OrgSwitcher, { type OrgOption } from "@/components/dashboard/OrgSwitcher";
import OnboardingTourController from "@/components/dashboard/OnboardingTourController";
import { useLanguage } from "@/components/LanguageProvider";
import type { ProfileForTour } from "@/lib/onboardingTour";

// Where a manual "pull down to check for new activity" gesture actually
// makes sense: list/overview pages showing something that can genuinely
// change on its own (new orders, new bookings, a fresh subscriber) —
// exactly the case a manual refresh gesture exists for. Deliberately an
// allowlist of exact paths, not a blanket wrap around the whole dashboard
// (which is what this used to be) and not a prefix match either: a
// prefix like "/dashboard/bookings" would also match
// "/dashboard/bookings/settings" and "/dashboard/bookings/<uuid>", which
// are exactly the pages this needs to stay OFF for — a single record's
// detail view, a settings form, or (most importantly) the profile editor
// and the ticket-type editor nested inside /dashboard/tickets/<id>, both
// of which hold real typed-but-not-yet-saved state that an accidental
// drag-to-refresh would silently wipe with no "unsaved changes" warning
// at all. New pages default to OFF until deliberately added here, rather
// than every future page silently inheriting a gesture that isn't always
// wanted.
const PULL_TO_REFRESH_PATHS = new Set([
  "/dashboard/analytics",
  "/dashboard/restaurant",
  "/dashboard/restaurant/orders",
  "/dashboard/restaurant/kitchen",
  "/dashboard/restaurant/tables",
  "/dashboard/restaurant/customers",
  "/dashboard/restaurant/sales",
  "/dashboard/music",
  "/dashboard/music/orders",
  "/dashboard/music/customers",
  "/dashboard/music/sales",
  "/dashboard/music/earnings",
  "/dashboard/bookings",
  "/dashboard/community",
  "/dashboard/community/subscribers",
  "/dashboard/community/announcements",
  "/dashboard/tickets",
  "/dashboard/requests",
]);

export default function DashboardShell({
  userId,
  email,
  username,
  avatarUrl,
  planName,
  isFreePlan,
  isVerified = false,
  canApproveRequests = false,
  isRestaurant = false,
  isMusic = false,
  hasTicketing = false,
  canManageTeam = false,
  canManageAssociation = false,
  canUseLoyalty = false,
  organization = null,
  organizations = [],
  ownProfileId = null,
  teamBadgesEnabled = true,
  subscriptionBanner = null,
  isDemo = false,
  showOnboardingTour = false,
  onboardingProfile = null,
  appName,
  logoUrl,
  children,
}: {
  // Used only to scope the notification bell to this account's own rows
  // (see src/components/NotificationBell.tsx) — optional so nothing
  // breaks if a caller doesn't have it handy, the bell just stays hidden.
  userId?: string;
  email: string;
  username: string;
  avatarUrl?: string | null;
  planName: string;
  isFreePlan: boolean;
  // Platform branding (src/lib/branding.ts) — the sidebar/header wordmark
  // and logo aren't hardcoded so an admin can rebrand the whole platform
  // from /admin/branding without a code change.
  appName: string;
  logoUrl: string;
  // Whether the account already has the blue-tick badge — decides which
  // item AvatarMenu shows: "Request verification" or a plain "Verified"
  // label. See src/components/dashboard/VerificationRequestModal.tsx.
  isVerified?: boolean;
  // "Super creator" permission — an admin-granted, narrower-than-admin
  // ability to review signup requests. See src/lib/assertAdmin.ts
  // (assertCanApproveRequests) and src/app/dashboard/requests/.
  canApproveRequests?: boolean;
  // One nav entry, not five — Orders/Kitchen/Tables/Sales/Customers live
  // behind it as tabs in /dashboard/restaurant's own layout, so the global
  // nav (and the space-constrained mobile tab bar) doesn't have to grow a
  // whole category's worth of pages for every restaurant owner.
  isRestaurant?: boolean;
  // Same pattern as isRestaurant — Orders/Sales/Customers live behind this
  // one entry as tabs in /dashboard/music's own layout.
  isMusic?: boolean;
  // Music & Entertainment or Events & Experiences (see
  // profileHasTicketing) — its own top-level section, same reasoning as
  // Bookings' own button: events, ticket types, Gate Access, and Check-in
  // all live at /dashboard/tickets/*, not tucked inside the main editor.
  hasTicketing?: boolean;
  // Team & Organization Management — whether this account can see/manage
  // the Team section: the owner always can, a staff member only with the
  // staff.view permission (see dashboard/layout.tsx). Never trusted as the
  // actual security boundary — that's staff.* permission checks server-side
  // (RLS + the /api/team/* routes) — this only decides whether the nav
  // item and workspace banner render.
  canManageTeam?: boolean;
  // Association Program — whether this account can see the Association
  // nav item: the signed-in person's own profile is an Owner on an
  // association-enabled plan, or they're an active Partner of at least
  // one Association. Independent of Team's organization concept entirely
  // (see src/lib/association/access.ts). Never trusted as the actual
  // security boundary — same posture as canManageTeam above.
  canManageAssociation?: boolean;
  // Ringo Loyalty nav item. Available on every plan; computed in dashboard/layout.tsx from the
  // active organization's category and the viewer's loyalty permissions. UX only: the pages and
  // /api/loyalty/* enforce access themselves.
  canUseLoyalty?: boolean;
  // Which organization's workspace this is, and whether the signed-in
  // person is staff there rather than its owner — drives the "WHICH
  // BUSINESS AM I WORKING FOR" banner shown just for staff (an owner's own
  // dashboard has no such ambiguity to clear up).
  organization?: { profileId: string; name: string; roleName: string | null; isStaff: boolean } | null;
  // Every organization this account belongs to (their own + any they're an
  // active team member of) — the switcher only renders when there's more
  // than one.
  organizations?: OrgOption[];
  // The signed-in person's OWN profile id + their current opt-out state
  // for the public "current role" badge (see ProfileView.tsx) — always
  // about their own account, independent of `organization` above, which is
  // whichever business's workspace they're currently viewing. Passed
  // through to AvatarMenu, the account-level settings surface this toggle
  // belongs in.
  ownProfileId?: string | null;
  teamBadgesEnabled?: boolean;
  // Persistent "renew soon" banner for a Fapshi/manual (fixed-duration)
  // account approaching or past its plan_expires_at — see
  // src/lib/subscriptionReminderSettings.ts's getSubscriptionBannerState,
  // computed server-side in dashboard/layout.tsx. Null (the common case:
  // Free, Stripe, or a paid-up fixed-duration plan) renders nothing.
  subscriptionBanner?: { state: "expiring_soon" | "grace_period"; daysRemaining: number } | null;
  // "Try the dashboard" demo accounts (see
  // supabase/migrations/2026-10-13_demo_accounts.sql) — true for the
  // signed-in account's own profile, independent of which organization's
  // workspace is currently active. Renders a persistent, non-dismissible
  // banner (below) so it can never be missed and forgotten mid-session.
  isDemo?: boolean;
  // First-login-only onboarding tour (see OnboardingTourController.tsx) —
  // resolved server-side in dashboard/layout.tsx against the signed-in
  // person's OWN profile (never completed, never dismissed, and never
  // while acting as staff inside someone else's organization). Mounted
  // here rather than on any single page because several of its steps'
  // targets live on entirely different /dashboard/** pages.
  showOnboardingTour?: boolean;
  onboardingProfile?: ProfileForTour | null;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const shouldReduceMotion = useReducedMotion();

  // `core: true` marks the small set of items the mobile bottom tab bar
  // actually shows (Editor, Community, Ringo Card, Analytics,
  // Subscription) — kept deliberately short so the space-constrained tab
  // bar never has to scroll. Everything else defaults to living in the
  // mobile header's "More" hamburger menu (see MobileMoreMenu.tsx) instead
  // — including any category-specific item added here in the future — so
  // a new nav entry never has to also update the tab bar's item count.
  // The desktop sidebar is unaffected by this split: it always renders
  // every item below, core or not, since it has the room for it.
  const NAV_ITEMS = [
    { href: "/dashboard", label: t.nav.editor, icon: LayoutGrid, exact: true, core: true },
    // Restaurant is safe to show to staff regardless: requireRestaurantProfile
    // is org-aware (resolves the active organization, not just an owned
    // profile) and RestaurantTabs filters its own sub-nav to the viewer's
    // actual permissions — see that component's own comment.
    ...(isRestaurant ? [{ href: "/dashboard/restaurant", label: t.nav.restaurant, icon: UtensilsCrossed, core: false }] : []),
    // Music/Tickets/Bookings, unlike Restaurant, are NOT org-aware yet —
    // requireMusicProfile/requireTicketingProfile/requireOwnProfile still
    // resolve the viewer's OWN profile only (the pre-Team pattern), with no
    // concept of "the organization I'm currently viewing as staff" at all.
    // For an owner that's harmless (their own profile IS the org). For
    // staff it's actively wrong: they'd silently see their OWN unrelated
    // profile's music/tickets/bookings while the org-branding banner still
    // says they're working inside someone else's business — worse than a
    // permission bounce, since nothing indicates the data on screen belongs
    // to the wrong account. Hidden entirely for staff until those three
    // page guards are rewritten to be organization-aware (a real follow-up
    // of its own, not attempted here) — same reasoning as filtering
    // RestaurantTabs to what's actually enforced, just one level up.
    ...(isMusic && !organization?.isStaff ? [{ href: "/dashboard/music", label: t.nav.musicSales, icon: Music2, core: false }] : []),
    // Its own section, not nested inside Music's editor — Events &
    // Experiences profiles get this without needing Music's other tools.
    ...(hasTicketing && !organization?.isStaff ? [{ href: "/dashboard/tickets", label: t.nav.tickets, icon: Ticket, core: false }] : []),
    // Universal, unlike Restaurant/Music above — every category can turn
    // bookings on, so this is never gated by category. Always visible (not
    // hidden until enabled) so an owner can actually find Settings to turn
    // it on in the first place — but still hidden for staff, same
    // not-yet-org-aware reasoning as Music/Tickets above.
    ...(!organization?.isStaff ? [{ href: "/dashboard/bookings", label: t.nav.bookings, icon: CalendarCheck, core: false }] : []),
    // Same "always visible" reasoning as Bookings above — every category
    // can build a community, so this isn't gated either.
    { href: "/dashboard/community", label: t.nav.community, icon: Users, core: true },
    // Org-aware (resolves the active organization), so unlike Music/Tickets/Bookings it is safe to show staff.
    ...(canUseLoyalty ? [{ href: "/dashboard/loyalty", label: t.nav.loyalty, icon: Gift, core: false }] : []),
    // Ringo Card Writer — every creator can own a physical Ringo Card
    // regardless of category, so (like Bookings/Community) this is never
    // gated. See src/app/dashboard/ringo-card/page.tsx.
    { href: "/dashboard/ringo-card", label: t.nav.ringoCard, icon: Nfc, core: true },
    { href: "/dashboard/analytics", label: t.nav.analytics, icon: BarChart3, core: true },
    { href: "/dashboard/affiliate", label: t.nav.affiliate, icon: Handshake, core: false },
    // Team & Organization Management — gated on canManageTeam, not just
    // "is the owner": a staff member with the staff.view permission also
    // sees this (e.g. a Manager reviewing the roster), scoped to whichever
    // organization is currently active.
    ...(canManageTeam ? [{ href: "/dashboard/team", label: t.nav.team, icon: UserCog, core: false }] : []),
    // Association Program — its own top-level entry, gated on
    // canManageAssociation (Owner or active Partner), never on canManageTeam
    // or `organization` — the two features are entirely independent.
    ...(canManageAssociation ? [{ href: "/dashboard/association", label: t.nav.association, icon: Award, core: false }] : []),
    { href: "/dashboard/subscription", label: t.nav.subscription, icon: CreditCard, core: true },
    ...(canApproveRequests
      ? [
          { href: "/dashboard/requests", label: t.nav.requests, icon: ClipboardCheck, core: false },
          { href: "/dashboard/qr-code", label: t.nav.qrCode, icon: QrCode, core: false },
        ]
      : []),
  ];

  const mobileTabItems = NAV_ITEMS.filter((item) => item.core);
  const moreMenuItems = NAV_ITEMS.filter((item) => !item.core);

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const currentLabel = [...NAV_ITEMS].reverse().find(({ href, exact }) => isActive(href, exact))?.label;

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[264px_1fr]">
      {/* Registers the "Add to Home Screen" service worker for the whole
          dashboard — see RegisterServiceWorker.tsx and
          AddToHomeScreenMenuItem.tsx (surfaced from AvatarMenu below). */}
      <RegisterServiceWorker />
      <AppBadgeReset />
      {/* Feeds the admin Users analytics view's "currently using as
          installed app" and "has installed at least once" signals — see
          that component's own comment for what it does and why it's
          scoped to the dashboard only. */}
      <ActivitySignals />

      {/* Proactively asks to enable push, instead of relying on someone
          noticing a header icon — see that component's own comment. The
          manual on/off control still lives in AvatarMenu's account menu
          for anyone who dismissed this or wants to turn it off later. */}
      <PushPermissionPrompt subscribeUrl="/api/push/subscribe" body={t.pushNotifications.promptBodyDashboard} />

      {/* Desktop sidebar — the persistent nav. Every dashboard page renders
          inside this layout, so this never re-mounts between pages. */}
      <aside className="hidden lg:flex flex-col justify-between border-r border-ringo-border/70 bg-ringo-surface/40 p-5 h-screen sticky top-0">
        <div>
          <Link href="/" className="flex items-center px-1 text-ringo-text">
            <BrandLogo
              logoUrl={logoUrl}
              appName={appName}
              variant="full"
              height={28}
              legacy={
                <span className="flex items-center gap-2.5">
                  <Image src={logoUrl} alt={appName} width={30} height={30} className="rounded-[9px] object-contain shadow-[0_2px_8px_-2px_rgba(79,70,229,0.4)]" />
                  <span className="font-display font-semibold text-[15px] text-ringo-text tracking-[-0.01em]">{appName}</span>
                </span>
              }
            />
          </Link>
          {/* Signature: a quiet gradient line — same brand signal as the
              animated rings on the auth pages, at rest for a daily-use screen. */}
          <div className="h-[2px] w-full mt-4 mb-6 rounded-full bg-gradient-to-r from-ringo-indigo via-ringo-coral to-ringo-teal opacity-70" />

          <p className="px-3.5 mb-2 text-[10px] font-semibold uppercase tracking-wider text-ringo-muted/70">
            {t.nav.menu}
          </p>
          <nav className="flex flex-col gap-0.5">
            {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`group relative flex items-center gap-3 pl-3.5 pr-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150 ${
                    active
                      ? "bg-ringo-indigo/10 text-ringo-indigo"
                      : "text-ringo-muted hover:bg-ringo-muted/10 hover:text-ringo-text hover:translate-x-0.5"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 h-4 w-[3px] rounded-full bg-ringo-indigo" />
                  )}
                  <Icon size={17} strokeWidth={active ? 2.3 : 2} />
                  {label}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex flex-col gap-3">
          {isFreePlan && (
            <Link
              href="/dashboard/subscription"
              className="block rounded-2xl p-3.5 bg-gradient-to-br from-ringo-indigo to-ringo-indigo/85 text-white shadow-[0_8px_20px_-6px_rgba(79,70,229,0.45)] transition-transform hover:-translate-y-0.5"
            >
              <p className="text-xs font-medium opacity-80 mb-0.5">{t.sidebar.freeBadge}</p>
              <p className="text-sm font-medium mb-2.5 leading-snug">{t.sidebar.unlockFeatures}</p>
              <span className="text-xs font-medium underline underline-offset-2">{t.sidebar.upgradePlan}</span>
            </Link>
          )}

          {/* Organization switcher — only rendered when this account
              actually belongs to more than one organization (their own,
              plus at least one they're a team member of). See
              src/lib/team/access.ts for how "active organization" is
              picked and persisted (a plain preference cookie, never a
              security boundary). */}
          {organizations.length > 1 && organization && (
            <div className="mb-3">
              <OrgSwitcher current={organization.profileId} organizations={organizations} />
            </div>
          )}

          {/* Compact identity card — quick "who am I" + a shortcut to the
              live page, without duplicating what AvatarMenu already does. */}
          <Link
            href={`/${username}`}
            target="_blank"
            className="flex items-center gap-2.5 rounded-xl border border-ringo-border/70 px-3 py-2.5 transition hover:bg-ringo-muted/10"
          >
            <span className="w-8 h-8 rounded-full overflow-hidden flex items-center justify-center bg-ringo-indigo text-white text-xs font-medium shrink-0">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatarUrl} alt={username} className="w-full h-full object-cover" />
              ) : (
                username?.[0]?.toUpperCase() || "?"
              )}
            </span>
            <span className="flex-1 min-w-0">
              <span className="block text-xs font-medium text-ringo-text truncate">@{username}</span>
              <span className="block text-[11px] text-ringo-muted truncate">{t.account.viewPage}</span>
            </span>
            <ExternalLink size={13} className="text-ringo-muted shrink-0" />
          </Link>
        </div>
      </aside>

      <div className="relative flex flex-col min-h-screen">
        {/* Quiet depth cue behind every page's content — a large, very low
            opacity brand-colored glow, fixed so it doesn't scroll or shift
            page to page. Never above 8% opacity: a signature, not a design
            element anyone should consciously notice. */}
        <div
          className="pointer-events-none fixed inset-x-0 top-0 h-[480px] -z-10 opacity-[0.06] dark:opacity-[0.1]"
          style={{ background: "radial-gradient(640px circle at 15% -10%, #4F46E5, transparent 65%)" }}
          aria-hidden
        />

        {/* Top header — page title on the left (desktop/tablet), account
            controls on the right, everywhere. */}
        <div className="flex items-center justify-between gap-2 px-4 lg:px-10 py-3.5 sticky top-0 z-30 bg-ringo-bg/85 backdrop-blur border-b border-ringo-border/70">
          <div className="flex items-center gap-2 min-w-0">
            {/* Hamburger menu — mobile only, holds every nav item that
                isn't one of the tab bar's 5 core ones (see moreMenuItems
                above). Sits before the logo, the conventional hamburger
                position. */}
            <MobileMoreMenu
              items={moreMenuItems}
              label={t.nav.more}
              isActive={isActive}
              organizations={organizations}
              currentOrgId={organization?.profileId}
            />
            <Link href="/" className="flex items-center gap-2 lg:hidden shrink-0">
              <BrandLogo
                logoUrl={logoUrl}
                appName={appName}
                variant="symbol"
                height={26}
                legacy={<Image src={logoUrl} alt={appName} width={26} height={26} className="rounded-lg object-contain" />}
              />
            </Link>
            {currentLabel && (
              <h1 className="hidden sm:block text-[15px] font-semibold text-ringo-text truncate">{currentLabel}</h1>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <LanguageToggle />
            {userId && <NotificationBell mode="user" userId={userId} backdropTop="top-16" />}
            <ThemeToggle iconOnly />
            <span className="w-px h-5 bg-ringo-border mx-1 hidden sm:block" />
            <AvatarMenu
              email={email}
              username={username}
              avatarUrl={avatarUrl}
              planName={planName}
              isVerified={isVerified}
              ownProfileId={ownProfileId}
              teamBadgesEnabled={teamBadgesEnabled}
            />
          </div>
        </div>

        {/* "WHO AM I? WHICH BUSINESS AM I WORKING FOR?" — shown only when
            acting as staff inside someone else's organization (never for
            an owner, who has no such ambiguity about their own account).
            Deliberately simple: business name + role, nothing else — see
            the product spec's own mockup for why this stays this plain. */}
        {organization?.isStaff && (
          <div className="px-4 lg:px-10 py-2 border-b border-ringo-border/70 bg-ringo-indigo/5 flex items-center gap-2 text-xs">
            <span className="font-semibold text-ringo-text truncate">{organization.name}</span>
            {organization.roleName && (
              <span className="shrink-0 px-2 py-0.5 rounded-full bg-ringo-indigo/10 text-ringo-indigo font-medium uppercase tracking-wide text-[10px]">
                {organization.roleName}
              </span>
            )}
          </div>
        )}

        {/* Persistent while expiring soon or in the grace period — amber
            for "renew soon," red once access is actually at risk (grace
            period, the last stretch before downgrade to Free). Shown on
            every dashboard page, not dismissible, so it can't be missed
            and forgotten about the way a one-time toast could be. */}
        {subscriptionBanner && (
          <Link
            href="/dashboard/subscription"
            className={`px-4 lg:px-10 py-2 border-b flex items-center gap-2 text-xs font-medium transition-colors ${
              subscriptionBanner.state === "grace_period"
                ? "border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-400 hover:bg-red-500/15"
                : "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15"
            }`}
          >
            <AlertTriangle size={13} className="shrink-0" />
            <span className="truncate">
              {subscriptionBanner.state === "grace_period"
                ? `Your subscription has expired — renew within ${subscriptionBanner.daysRemaining} day${
                    subscriptionBanner.daysRemaining === 1 ? "" : "s"
                  } to keep your access.`
                : `Your subscription expires in ${subscriptionBanner.daysRemaining} day${
                    subscriptionBanner.daysRemaining === 1 ? "" : "s"
                  } — renew now to avoid losing access.`}
            </span>
            <span className="shrink-0 underline underline-offset-2">Renew</span>
          </Link>
        )}

        {/* Persistent, non-dismissible — a demo account's changes really
            aren't permanent (see the cleanup cron), so this must stay
            visible on every dashboard page for the whole session, not just
            show once as a toast. */}
        {isDemo && (
          <Link
            href="/auth/signup"
            className="px-4 lg:px-10 py-2 border-b border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/15 flex items-center gap-2 text-xs font-medium transition-colors"
          >
            <AlertTriangle size={13} className="shrink-0" />
            <span className="truncate">{t.demo.dashboardBanner}</span>
            <span className="shrink-0 underline underline-offset-2">{t.demo.dashboardBannerCta}</span>
          </Link>
        )}

        {/* Custom pull-to-refresh (touch-only, so this is a no-op on
            desktop by construction — see PullToRefresh.tsx) wraps the
            page-transition block below, so pulling down reveals its
            indicator right under the sticky header and pushes the same
            content the transition itself animates. Only mounted on pages
            where the gesture is actually relevant (see
            PULL_TO_REFRESH_PATHS above) — everywhere else this renders
            `content` directly with no gesture listener at all, not just a
            disabled one. */}
        {(() => {
          const content = (
            <motion.main
              key={pathname}
              initial={shouldReduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: "easeOut" }}
              className="flex-1 px-4 sm:px-6 lg:px-10 py-6 lg:py-8 pb-28 lg:pb-10"
            >
              {children}
            </motion.main>
          );
          // Keyed on pathname so switching sections (tap Music, tap
          // Community, …) always plays a quick fade + tiny slide-in for
          // the new content instead of it just snapping into place —
          // coordinated with the bottom tab bar's pill morph and the
          // header's title swap, which both animate on the same
          // navigation. No exit animation: the old content unmounts
          // immediately rather than waiting, so the new page never feels
          // delayed. Skipped entirely under prefers-reduced-motion.
          return PULL_TO_REFRESH_PATHS.has(pathname) ? <PullToRefresh>{content}</PullToRefresh> : content;
        })()}

        {/* Mobile bottom tab bar — a floating glass dock, not a shrunk
            sidebar. Frosted, translucent, and centered (a fixed 5 core
            items always fit, so it never needs to stretch edge-to-edge)
            with a thin border and a restrained shadow doing the "glass"
            work instead of any gradient or glow. The active tab's pill
            background is one shared element (via framer-motion's
            layoutId) that morphs between tabs rather than just toggling
            per-item, tuned fast and nearly bounce-free to feel crisp
            rather than springy. Icon + label both get a small settle
            animation on activation, and every tab gets a quick press
            scale for tactile feedback. Purely mobile (lg:hidden):
            desktop's sidebar above already has an always-visible active
            state and doesn't need this treatment. Category-specific and
            secondary items stay out of this dock entirely — they live in
            MobileMoreMenu's hamburger, kept deliberately separate. */}
        <nav
          className="lg:hidden fixed bottom-3 inset-x-3 z-40 mx-auto flex max-w-[420px] items-center gap-0.5 rounded-[28px] border border-ringo-border/60 bg-ringo-surface/75 px-1.5 py-1.5 shadow-[0_10px_28px_-10px_rgba(15,23,42,0.2)] backdrop-blur-2xl"
          style={{ marginBottom: "env(safe-area-inset-bottom)" }}
        >
          {mobileTabItems.map(({ href, label, icon: Icon, exact }) => {
            const active = isActive(href, exact);
            return (
              // flex-1 + min-w-0: the 5 tabs share the dock's width equally
              // instead of each sizing to its label plus fixed padding, so
              // the last one (Subscription) is always on screen — no
              // horizontal scrolling to discover it.
              <Link key={href} href={href} className="relative flex-1 min-w-0">
                <motion.span
                  whileTap={{ scale: 0.92 }}
                  transition={{ type: "spring", stiffness: 600, damping: 32 }}
                  className="relative flex flex-col items-center gap-0.5 rounded-full px-1 py-1.5 text-[11px] font-medium"
                >
                  {active && (
                    <motion.span
                      layoutId="mobile-tab-active"
                      className="absolute inset-0 rounded-full bg-ringo-indigo/12"
                      transition={{ type: "spring", stiffness: 700, damping: 45, mass: 0.6 }}
                    />
                  )}
                  <span className="relative flex flex-col items-center gap-0.5">
                    <motion.span
                      animate={{ y: active ? -1 : 0, scale: active ? 1.08 : 1 }}
                      transition={{ type: "spring", stiffness: 500, damping: 26 }}
                    >
                      <Icon
                        size={19}
                        strokeWidth={active ? 2.4 : 2}
                        className={active ? "text-ringo-indigo" : "text-ringo-muted"}
                      />
                    </motion.span>
                    <span className={`max-w-full truncate transition-colors duration-150 ${active ? "text-ringo-indigo" : "text-ringo-muted"}`}>
                      {label}
                    </span>
                  </span>
                </motion.span>
              </Link>
            );
          })}
        </nav>
      </div>

      <HelpWidget username={username} email={email} />

      {showOnboardingTour && onboardingProfile && (
        <OnboardingTourController showOnboardingTour={showOnboardingTour} profile={onboardingProfile} username={username} />
      )}
    </div>
  );
}