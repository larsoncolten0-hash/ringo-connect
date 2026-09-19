"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, History, Link2, MessageCircle, Music, User } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { MyConnection } from "@/lib/customer/connections";
import type { ActivityItem, LibraryTrack } from "@/lib/customer/activity";
import ConnectionCard from "./ConnectionCard";
import CustomerAvatar from "./CustomerAvatar";
import EmptyState from "./EmptyState";
import SignOutButton from "./SignOutButton";
import DisconnectDialog from "./DisconnectDialog";
import InstallCard from "./InstallCard";
import MyMusicList from "./MyMusicList";
import NotificationsCard from "./NotificationsCard";

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
}: {
  customer: { name: string; avatarUrl: string | null };
  connections: MyConnection[];
  activity: ActivityItem[];
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
              const label = {
                connected: t.myRingo.activity.connected,
                disconnected: t.myRingo.activity.disconnected,
                music_order: t.myRingo.activity.musicPurchase,
                restaurant_order: t.myRingo.activity.restaurantOrder,
                booking: t.myRingo.activity.booking,
              }[item.kind];
              return (
                <li key={item.id} className="flex items-center justify-between gap-3 border-b border-ringo-border/60 px-4 py-3 last:border-0">
                  <p className="truncate text-sm text-ringo-text">
                    {label}
                    {item.profile ? ` · ${item.profile.name}` : ""}
                  </p>
                  <span className="shrink-0 text-xs text-ringo-muted" suppressHydrationWarning>
                    {new Date(item.at).toLocaleDateString(dateLocale, { day: "numeric", month: "short" })}
                  </span>
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

export function ConnectionsView({ connections }: { connections: MyConnection[] }) {
  const { t } = useLanguage();
  const router = useRouter();
  // Local copy so a disconnected profile leaves the list immediately; the
  // server (router.refresh) stays the source of truth.
  const [list, setList] = useState(connections);
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
            setConfirming(null);
            router.refresh();
          }}
        />
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
        <MyMusicList tracks={tracks} />
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
  customer: { name: string; email: string; phone: string | null; avatarUrl: string | null; preferredLanguage: "en" | "fr" | null };
}) {
  const { t } = useLanguage();
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

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ringo-text">{t.myRingo.appSection}</h2>
        <InstallCard />
        <NotificationsCard />
      </section>

      <SignOutButton />
    </div>
  );
}
