"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, ChevronRight, History, Link2, Loader2, MailQuestion, MessageCircle, Music, User } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { MyConnection } from "@/lib/customer/connections";
import type { ActivityItem, LibraryTrack } from "@/lib/customer/activity";
import ConnectionCard from "./ConnectionCard";
import CustomerAvatar from "./CustomerAvatar";
import EmptyState from "./EmptyState";
import SignOutButton from "./SignOutButton";
import ConfirmEmailDialog from "./ConfirmEmailDialog";
import DisconnectDialog from "./DisconnectDialog";
import InstallCard from "./InstallCard";
import MyMusicList, { PlayAllBar } from "./MyMusicList";
import NotificationsCard from "./NotificationsCard";
import LoyaltyTiles from "./loyalty/LoyaltyTiles";
import { isLoyaltyKind, loyaltyKindLabel } from "./loyalty/activityText";

// Client views for the My Ringo pages. Each page (a server component)
// authorizes via the customer session, fetches only that customer's own
// data, and hands plain props down — these components never fetch or accept
// an id from the browser.

const HOME_CONNECTIONS = 4;
const HOME_ACTIVITY = 5;

function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <h1 className="font-display text-2xl font-bold tracking-tight text-ringo-text">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ringo-muted">{subtitle}</p>}
    </div>
  );
}

export function HomeView({
  customer,
  connections,
  activity,
  rewardsReady = 0,
}: {
  customer: { name: string; avatarUrl: string | null };
  connections: MyConnection[];
  activity: ActivityItem[];
  // Rewards waiting for this customer (Ringo Loyalty), read on the server.
  rewardsReady?: number;
}) {
  const { t, locale } = useLanguage();
  const dateLocale = locale === "fr" ? "fr-FR" : "en-US";

  return (
    <div className="flex flex-col gap-8">
      <section className="flex items-center gap-4 rounded-3xl border border-ringo-border/70 bg-ringo-surface p-5">
        <CustomerAvatar name={customer.name} avatarUrl={customer.avatarUrl} className="w-16 h-16 text-xl" />
        <div className="min-w-0">
          <h1 className="truncate font-display text-2xl font-bold tracking-tight text-ringo-text">
            {t.myRingo.welcomeBack(customer.name)}
          </h1>
          <p className="mt-1 text-sm text-ringo-muted">{t.myRingo.homeSubtitle}</p>
        </div>
      </section>

      <InstallCard compact />

      <LoyaltyTiles rewardsReady={rewardsReady} />

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ringo-text">{t.myRingo.home.yourConnections}</h2>
          {connections.length > HOME_CONNECTIONS && (
            <Link href="/my-ringo/connections" className="text-xs font-medium text-ringo-indigo hover:underline">
              {t.myRingo.home.viewAll}
            </Link>
          )}
        </div>
        {connections.length === 0 ? (
          <EmptyState icon={Link2} title={t.myRingo.connections.emptyTitle} body={t.myRingo.connections.emptyBody} />
        ) : (
          <div className="flex flex-col gap-2.5">
            {connections.slice(0, HOME_CONNECTIONS).map((c) => (
              <ConnectionCard key={c.id} connection={c} />
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ringo-text">{t.myRingo.home.recentActivity}</h2>
          {activity.length > 0 && (
            <Link href="/my-ringo/activity" className="text-xs font-medium text-ringo-indigo hover:underline">
              {t.myRingo.home.viewAll}
            </Link>
          )}
        </div>
        {activity.length === 0 ? (
          <EmptyState icon={History} title={t.myRingo.home.activityEmpty} />
        ) : (
          // Real records only — the same feed as the Activity page (connections,
          // purchases, orders, bookings that belong to this customer).
          <ul className="overflow-hidden rounded-2xl border border-ringo-border/70 bg-ringo-surface">
            {activity.slice(0, HOME_ACTIVITY).map((item) => {
              const label = isLoyaltyKind(item.kind)
                ? loyaltyKindLabel(t, item.kind)
                : {
                    connected: t.myRingo.activity.connected,
                    disconnected: t.myRingo.activity.disconnected,
                    music_order: t.myRingo.activity.musicPurchase,
                    restaurant_order: t.myRingo.activity.restaurantOrder,
                    booking: t.myRingo.activity.booking,
                  }[item.kind];
              return (
                <li key={item.id} className="border-b border-ringo-border/60 last:border-0">
                  {/* Opens the Activity page scrolled to (and highlighting) this exact entry. */}
                  <Link
                    href={`/my-ringo/activity#activity-${item.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-ringo-muted/[0.05]"
                  >
                    <p className="truncate text-sm text-ringo-text">
                      {label}
                      {item.profile ? ` · ${item.profile.name}` : ""}
                    </p>
                    <span className="flex shrink-0 items-center gap-1.5 text-xs text-ringo-muted" suppressHydrationWarning>
                      {new Date(item.at).toLocaleDateString(dateLocale, { day: "numeric", month: "short" })}
                      <ChevronRight size={14} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ringo-text">{t.myRingo.home.quickActions}</h2>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {[
            { href: "/my-ringo/connections", label: t.myRingo.home.qaConnections, Icon: Link2 },
            { href: "/my-ringo/activity", label: t.myRingo.nav.activity, Icon: History },
            { href: "/my-ringo/me", label: t.myRingo.home.qaMe, Icon: User },
          ].map(({ href, label, Icon }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-3.5 text-sm font-medium text-ringo-text transition hover:border-ringo-indigo/40 active:scale-[0.99]"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-ringo-indigo/10 text-ringo-indigo">
                <Icon size={17} />
              </span>
              <span className="flex-1">{label}</span>
              <ChevronRight size={16} className="text-ringo-muted" />
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}

// A profile the customer disconnected from, with a one-tap Reconnect. Uses the same
// signed-in connect route as the public profile's Connect button (customer comes from the
// session cookie, never from the browser).
function PreviousConnectionRow({ connection, onReconnected }: { connection: MyConnection; onReconnected: (c: MyConnection) => void }) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { profile } = connection;

  const reconnect = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/customer/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profile_id: profile.id }),
      });
      if (res.status === 401) return window.location.replace("/my-ringo/signin");
      if (!res.ok) return setError(t.myRingo.connections.reconnectFailed);
      onReconnected(connection);
    } catch {
      setError(t.myRingo.connections.reconnectFailed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-ringo-border/70 bg-ringo-surface p-3.5">
      <div className="flex items-center gap-3">
        <CustomerAvatar name={profile.name} avatarUrl={profile.avatarUrl} className="w-10 h-10 text-sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ringo-text">{profile.name}</p>
          <p className="truncate text-xs text-ringo-muted">@{profile.username}</p>
        </div>
        <button
          type="button"
          onClick={reconnect}
          disabled={busy}
          className="flex shrink-0 items-center gap-1.5 rounded-xl bg-ringo-indigo px-3.5 py-2 text-xs font-semibold text-white transition active:scale-95 disabled:opacity-60"
        >
          {busy && <Loader2 size={13} className="animate-spin" />}
          {busy ? t.myRingo.connections.reconnecting : t.myRingo.connections.reconnect}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export function ConnectionsView({ connections, previous = [] }: { connections: MyConnection[]; previous?: MyConnection[] }) {
  const { t } = useLanguage();
  const router = useRouter();
  // Local copy so a disconnected profile leaves the list immediately; the
  // server (router.refresh) stays the source of truth.
  const [list, setList] = useState(connections);
  const [previousList, setPreviousList] = useState(previous);
  const [confirming, setConfirming] = useState<MyConnection | null>(null);

  return (
    <div>
      <PageTitle
        title={t.myRingo.connections.title}
        subtitle={list.length > 0 ? t.myRingo.connections.count(list.length) : undefined}
      />
      {list.length === 0 ? (
        <EmptyState icon={Link2} title={t.myRingo.connections.emptyTitle} body={t.myRingo.connections.emptyBody} />
      ) : (
        <div className="flex flex-col gap-2.5">
          {list.map((c) => (
            <ConnectionCard key={c.id} connection={c} showDate onDisconnect={setConfirming} />
          ))}
        </div>
      )}

      {confirming && (
        <DisconnectDialog
          profile={{ id: confirming.profile.id, name: confirming.profile.name }}
          onClose={() => setConfirming(null)}
          onDisconnected={(profileId) => {
            setList((prev) => prev.filter((c) => c.profile.id !== profileId));
            setPreviousList((prev) => [confirming, ...prev.filter((c) => c.profile.id !== profileId)]);
            setConfirming(null);
            router.refresh();
          }}
        />
      )}

      {previousList.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-1 text-sm font-semibold text-ringo-text">{t.myRingo.connections.previousTitle}</h2>
          <p className="mb-3 text-xs text-ringo-muted">{t.myRingo.connections.previousBody}</p>
          <div className="flex flex-col gap-2.5">
            {previousList.map((c) => (
              <PreviousConnectionRow
                key={c.id}
                connection={c}
                onReconnected={(done) => {
                  setPreviousList((prev) => prev.filter((p) => p.profile.id !== done.profile.id));
                  setList((prev) => [{ ...done, connectedAt: new Date().toISOString() }, ...prev]);
                  router.refresh();
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function MusicView({ tracks }: { tracks: LibraryTrack[] }) {
  const { t } = useLanguage();
  return (
    <div>
      <PageTitle title={t.myRingo.music.title} subtitle={tracks.length > 0 ? t.myRingo.library.subtitle(tracks.length) : undefined} />
      {tracks.length === 0 ? (
        <EmptyState icon={Music} title={t.myRingo.music.emptyTitle} body={t.myRingo.music.emptyBody} />
      ) : (
        <>
          <PlayAllBar tracks={tracks} />
          <MyMusicList tracks={tracks} />
        </>
      )}
    </div>
  );
}

export function InboxView() {
  const { t } = useLanguage();
  return (
    <div>
      <PageTitle title={t.myRingo.inbox.title} />
      <EmptyState icon={MessageCircle} title={t.myRingo.inbox.emptyTitle} body={t.myRingo.inbox.emptyBody} />
    </div>
  );
}

export function MeView({
  customer,
}: {
  customer: {
    name: string;
    email: string;
    phone: string | null;
    avatarUrl: string | null;
    preferredLanguage: "en" | "fr" | null;
    emailConfirmed: boolean;
  };
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const [emailConfirmed, setEmailConfirmed] = useState(customer.emailConfirmed);
  const [confirmingEmail, setConfirmingEmail] = useState(false);
  const languageName = customer.preferredLanguage === "en" ? "English" : customer.preferredLanguage === "fr" ? "Français" : null;

  const rows = [
    { label: t.myRingo.me.emailLabel, value: customer.email },
    { label: t.myRingo.me.phoneLabel, value: customer.phone },
    { label: t.myRingo.me.languageLabel, value: languageName },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={t.myRingo.me.title} />

      <section className="flex flex-col items-center gap-2 rounded-3xl border border-ringo-border/70 bg-ringo-surface px-5 py-8 text-center">
        <CustomerAvatar name={customer.name} avatarUrl={customer.avatarUrl} className="w-20 h-20 text-2xl" />
        <p className="mt-2 font-display text-xl font-bold text-ringo-text">{customer.name}</p>
        <p className="text-xs font-medium uppercase tracking-wider text-ringo-muted">{t.myRingo.me.member}</p>
      </section>

      <dl className="overflow-hidden rounded-2xl border border-ringo-border/70 bg-ringo-surface">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 border-b border-ringo-border/60 px-4 py-3.5 last:border-0">
            <dt className="text-sm text-ringo-muted">{r.label}</dt>
            <dd className="truncate text-sm font-medium text-ringo-text">{r.value || t.myRingo.me.notProvided}</dd>
          </div>
        ))}
      </dl>

      {/* Confirming the email is OPTIONAL — the account works the same either way. */}
      {emailConfirmed ? (
        <p className="flex items-center gap-2 rounded-2xl bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-600">
          <BadgeCheck size={16} /> {t.myRingo.account.emailConfirmed}
        </p>
      ) : (
        <div className="flex flex-col gap-3 rounded-2xl border border-ringo-border/70 bg-ringo-surface p-4 sm:flex-row sm:items-center">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ringo-muted/15 text-ringo-muted">
            <MailQuestion size={18} />
          </span>
          <div className="flex-1">
            <p className="text-sm font-semibold text-ringo-text">{t.myRingo.account.emailNotConfirmed}</p>
            <p className="mt-0.5 text-xs text-ringo-muted">{t.myRingo.account.optionalNote}</p>
          </div>
          <button
            onClick={() => setConfirmingEmail(true)}
            className="rounded-xl bg-ringo-indigo px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98]"
          >
            {t.myRingo.account.confirmEmail}
          </button>
        </div>
      )}
      {confirmingEmail && (
        <ConfirmEmailDialog
          email={customer.email}
          onClose={() => setConfirmingEmail(false)}
          onConfirmed={() => {
            setEmailConfirmed(true);
            router.refresh();
          }}
        />
      )}

      <LoyaltyTiles showTitle />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ringo-text">{t.myRingo.appSection}</h2>
        <InstallCard />
        <NotificationsCard />
      </section>

      <SignOutButton />
    </div>
  );
}
