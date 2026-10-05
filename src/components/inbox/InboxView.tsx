"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, FileText, Image as ImageIcon, MessageCircle, MessagesSquare, Mic, Search, Smile, TriangleAlert, Video, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import ConversationStatusButton from "@/components/inbox/ConversationStatusButton";
import ConversationReadMarker from "@/components/inbox/ConversationReadMarker";
import InboxAiPanel from "@/components/inbox/InboxAiPanel";
import ReplyComposer, { RetryButton } from "@/components/inbox/ReplyComposer";
import type { ConversationItem, SavedReply, ThreadData, ThreadMessage } from "@/lib/inbox/data";
import type { AutomationView } from "@/lib/inbox/automationData";
import type { LeadSignal } from "@/lib/inbox/leads";
import { formatBubbleTime, formatListTime, formatWaId, previewText, type InboxStatusFilter, type MediaKind } from "@/lib/inbox/format";

// The Inbox screen. All data arrives as props from the server pages (already scoped to the owner's profile); this component only renders it.
// Customer text is rendered as plain React text children (escaped), never as HTML. Media is shown as a metadata card: nothing is downloaded and
// no Meta URL or credential ever reaches the browser.
//
// Responsive: below `lg` it is a single pane. The conversation list is shown on /dashboard/inbox and the thread on
// /dashboard/inbox/<id> with a back link. From `lg` up both panes show side by side.

export type InboxFilter = { status: InboxStatusFilter; q: string };
export type InboxViewProps = {
  list: { ok: true; items: ConversationItem[]; truncated?: boolean } | { ok: false };
  selectedId: string | null;
  thread: { ok: true; thread: ThreadData } | { ok: false; reason: "not_found" | "error" } | null;
  /** Current list filter (default: open conversations, no search). */
  filter?: InboxFilter;
  /** Open conversations that have unread messages (for the Open tab). */
  unreadOpen?: number;
  /** The owner's saved replies; null when they are not available (the picker is then hidden). */
  savedReplies?: SavedReply[] | null;
  /** Derived lead signals and automatic-message labels (read-only); null when unavailable (the inbox then simply shows none). */
  automation?: AutomationView | null;
};

export const INBOX_PATH = "/dashboard/inbox";
const DEFAULT_FILTER: InboxFilter = { status: "open", q: "" };

/** Query string that keeps the current filter while moving around: "" for the defaults, otherwise ?status=...&q=... */
export function filterQuery(filter: InboxFilter, override: Partial<InboxFilter> = {}): string {
  const f = { ...filter, ...override };
  const p = new URLSearchParams();
  if (f.status !== "open") p.set("status", f.status);
  if (f.q) p.set("q", f.q);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export default function InboxView({ list, selectedId, thread, filter = DEFAULT_FILTER, unreadOpen = 0, savedReplies = null, automation = null }: InboxViewProps) {
  const { t } = useLanguage();
  const u = t.inbox;
  const hasSelection = selectedId !== null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="font-display text-xl font-medium text-ringo-text">{u.title}</h1>
          <Link href={`${INBOX_PATH}/settings`} className="inline-flex min-h-[36px] items-center rounded-full border border-ringo-border px-3 text-xs text-ringo-text hover:bg-ringo-surface">{u.automationLink}</Link>
        </div>
        <p className="mt-1 text-sm text-ringo-muted">{u.intro}</p>
      </div>

      {!list.ok ? (
        <ErrorPanel />
      ) : (
        <div className="grid gap-4 lg:h-[calc(100dvh-13rem)] lg:min-h-[480px] lg:grid-cols-[340px_minmax(0,1fr)]">
          <section aria-label={u.conversations} className={`${hasSelection ? "hidden lg:flex" : "flex"} min-h-0 flex-col overflow-hidden rounded-card border border-ringo-border`}>
            <h2 className="border-b border-ringo-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ringo-muted">{u.conversations}</h2>
            <ListControls filter={filter} unreadOpen={unreadOpen} />
            {list.items.length === 0 ? <EmptyList filter={filter} /> : <ConversationList items={list.items} selectedId={selectedId} truncated={list.truncated === true} filter={filter} signals={automation?.signals ?? null} />}
          </section>

          <section className={`${hasSelection ? "flex" : "hidden lg:flex"} min-h-0 flex-col overflow-hidden rounded-card border border-ringo-border`}>
            {thread === null ? (
              <NoSelection />
            ) : thread.ok ? (
              <Thread data={thread.thread} filter={filter} savedReplies={savedReplies} automation={automation} />
            ) : thread.reason === "not_found" ? (
              <NotFound filter={filter} />
            ) : (
              <ErrorPanel inPane retryHref={`${INBOX_PATH}/${selectedId}${filterQuery(filter)}`} />
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** Open / Closed / All tabs and a search box. Plain links and a GET form: they work without JavaScript and keep the filter in the URL. */
function ListControls({ filter, unreadOpen }: { filter: InboxFilter; unreadOpen: number }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const tabs: { id: InboxStatusFilter; label: string }[] = [
    { id: "open", label: u.filterOpen },
    { id: "closed", label: u.filterClosed },
    { id: "all", label: u.filterAll },
  ];
  return (
    <div className="flex flex-col gap-2 border-b border-ringo-border px-3 py-3">
      <form method="get" action={INBOX_PATH} role="search" className="relative">
        {filter.status !== "open" && <input type="hidden" name="status" value={filter.status} />}
        <label htmlFor="inbox-search" className="sr-only">{u.searchLabel}</label>
        <Search size={14} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ringo-muted" />
        <input
          id="inbox-search"
          type="search"
          name="q"
          defaultValue={filter.q}
          maxLength={80}
          autoComplete="off"
          placeholder={u.searchPlaceholder}
          className="block w-full rounded-full border border-ringo-border bg-transparent py-2 pl-9 pr-9 text-sm text-ringo-text placeholder:text-ringo-muted focus:border-ringo-indigo focus:outline-none"
        />
        {filter.q ? (
          <Link href={`${INBOX_PATH}${filterQuery(filter, { q: "" })}`} aria-label={u.clearSearch} className="absolute right-2 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-surface hover:text-ringo-text">
            <X size={14} aria-hidden="true" />
          </Link>
        ) : null}
        <button type="submit" className="sr-only">{u.searchButton}</button>
      </form>
      <nav aria-label={u.conversations} className="flex items-center gap-1.5">
        {tabs.map((tab) => {
          const active = filter.status === tab.id;
          return (
            <Link
              key={tab.id}
              href={`${INBOX_PATH}${filterQuery(filter, { status: tab.id })}`}
              aria-current={active ? "true" : undefined}
              className={`inline-flex min-h-[32px] items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors ${active ? "bg-ringo-indigo text-white" : "border border-ringo-border text-ringo-text hover:bg-ringo-surface"}`}
            >
              {tab.label}
              {tab.id === "open" && unreadOpen > 0 && (
                <span aria-label={u.unreadOpenLabel(unreadOpen)} className={`inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${active ? "bg-white/25 text-white" : "bg-ringo-indigo text-white"}`}>
                  {unreadOpen > 99 ? "99+" : unreadOpen}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}

function EmptyList({ filter }: { filter: InboxFilter }) {
  const { t } = useLanguage();
  const filtered = filter.q !== "" || filter.status === "closed";
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <MessagesSquare size={22} className="mb-2 text-ringo-muted" aria-hidden="true" />
      <p className="text-sm font-medium text-ringo-text">{filtered ? t.inbox.noMatchesTitle : t.inbox.emptyTitle}</p>
      <p className="text-xs text-ringo-muted">{filtered ? t.inbox.noMatchesBody : t.inbox.emptyBody}</p>
    </div>
  );
}

function NoSelection() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <MessageCircle size={22} className="mb-2 text-ringo-muted" aria-hidden="true" />
      <p className="text-sm font-medium text-ringo-text">{t.inbox.selectTitle}</p>
      <p className="text-xs text-ringo-muted">{t.inbox.selectBody}</p>
    </div>
  );
}

function NotFound({ filter }: { filter: InboxFilter }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-ringo-text">{t.inbox.threadNotFoundTitle}</p>
      <p className="text-xs text-ringo-muted">{t.inbox.threadNotFoundBody}</p>
      <Link href={`${INBOX_PATH}${filterQuery(filter)}`} className="text-xs font-medium text-ringo-indigo hover:underline lg:hidden">{t.inbox.back}</Link>
    </div>
  );
}

/** Safe, generic failure state: no SQL, no stack trace, no provider detail. */
function ErrorPanel({ inPane = false, retryHref = INBOX_PATH }: { inPane?: boolean; retryHref?: string }) {
  const { t } = useLanguage();
  return (
    <div role="alert" className={`flex flex-col items-center gap-2 p-8 text-center ${inPane ? "flex-1 justify-center" : "rounded-card border border-ringo-border"}`}>
      <TriangleAlert size={22} className="text-amber-600 dark:text-amber-400" aria-hidden="true" />
      <p className="text-sm font-medium text-ringo-text">{t.inbox.errorTitle}</p>
      <p className="text-xs text-ringo-muted">{t.inbox.errorBody}</p>
      <Link href={retryHref} className="mt-1 text-xs font-medium text-ringo-indigo hover:underline">{t.inbox.retry}</Link>
    </div>
  );
}

function ChannelBadge({ channel }: { channel: string }) {
  const { t } = useLanguage();
  if (channel !== "whatsapp") return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-ringo-muted">
      <MessageCircle size={12} className="text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
      {t.inbox.whatsapp}
    </span>
  );
}

function ConversationList({ items, selectedId, truncated, filter, signals }: { items: ConversationItem[]; selectedId: string | null; truncated: boolean; filter: InboxFilter; signals: Record<string, LeadSignal> | null }) {
  const { t, locale } = useLanguage();
  const u = t.inbox;
  const qs = filterQuery(filter);
  return (
    <ul className="min-h-0 flex-1 divide-y divide-ringo-border/60 overflow-y-auto">
      {items.map((c) => {
        const selected = c.id === selectedId;
        const name = c.contactName || u.unknownContact;
        const unread = c.unreadCount > 0;
        const text = c.preview ? previewText(c.preview, u) : u.noMessages;
        const preview = c.preview && c.lastDirection === "outbound" ? `${u.direction.outbound}: ${text}` : text;
        return (
          <li key={c.id}>
            <Link
              href={`${INBOX_PATH}/${c.id}${qs}`}
              aria-current={selected ? "page" : undefined}
              className={`flex gap-3 px-4 py-3 transition-colors hover:bg-ringo-surface ${selected ? "bg-ringo-surface" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className={`truncate text-sm ${unread ? "font-semibold text-ringo-text" : "font-medium text-ringo-text"}`}>{name}</span>
                  <time dateTime={c.lastMessageAt ?? undefined} suppressHydrationWarning className="shrink-0 text-[11px] text-ringo-muted">{formatListTime(c.lastMessageAt, locale)}</time>
                </div>
                <div className="mt-0.5 flex items-center justify-between gap-2">
                  <p className={`truncate text-xs ${unread ? "text-ringo-text" : "text-ringo-muted"}`}>{preview}</p>
                  {unread && (
                    <span aria-label={u.unreadLabel(c.unreadCount)} className="inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-ringo-indigo px-1.5 text-[11px] font-semibold text-white">
                      {c.unreadCount > 99 ? "99+" : c.unreadCount}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <ChannelBadge channel={c.channel} />
                  {c.status === "closed" && <span className="rounded-full bg-ringo-muted/15 px-2 py-0.5 text-[10px] text-ringo-muted">{u.closed}</span>}
                  {signals?.[c.id] && c.status !== "closed" && <LeadBadge signal={signals[c.id]} />}
                </div>
              </div>
            </Link>
          </li>
        );
      })}
      {truncated && <li className="px-4 py-3 text-center text-[11px] text-ringo-muted">{u.listLimited(items.length)}</li>}
    </ul>
  );
}

function Thread({ data, filter, savedReplies, automation }: { data: ThreadData; filter: InboxFilter; savedReplies: SavedReply[] | null; automation: AutomationView | null }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const endRef = useRef<HTMLDivElement | null>(null);
  // text the owner chose to insert from an AI draft; the composer puts it in the box (it is never sent for them)
  const [insert, setInsert] = useState<{ id: number; text: string } | null>(null);
  // open on the newest message
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [data.conversation.id, data.messages.length]);

  const name = data.contact.name || u.unknownContact;
  return (
    <>
      <ConversationReadMarker conversationId={data.conversation.id} />
      <header className="flex items-center gap-3 border-b border-ringo-border px-4 py-3">
        <Link href={`${INBOX_PATH}${filterQuery(filter)}`} aria-label={u.back} className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-surface hover:text-ringo-text lg:hidden">
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-ringo-text">{name}</h2>
          <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-ringo-muted">
            <ChannelBadge channel={data.conversation.channel} />
            {data.contact.waId && <span>{formatWaId(data.contact.waId)}</span>}
            {automation?.signals[data.conversation.id] && <LeadBadge signal={automation.signals[data.conversation.id]} />}
          </p>
          {automation?.signals[data.conversation.id] === "needs_follow_up" && (
            <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400" data-testid="follow-up-window">
              {automation.windowOpen[data.conversation.id] ? u.lead.windowOpen : u.lead.windowClosed}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
          <span className={`rounded-full px-2 py-0.5 text-[11px] ${data.conversation.status === "open" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-ringo-muted/15 text-ringo-muted"}`}>
            {data.conversation.status === "open" ? u.open : u.closed}
          </span>
          <ConversationStatusButton conversationId={data.conversation.id} status={data.conversation.status} />
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-testid="thread-scroll">
        {data.truncated && <p className="mb-3 text-center text-[11px] text-ringo-muted">{u.threadLimited(data.messages.length)}</p>}
        {data.messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-ringo-muted">{u.noMessages}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {data.messages.map((m) => (
              <Bubble key={m.id} m={m} conversationId={data.conversation.id} automatic={automation?.automaticMessageIds.includes(m.id) === true} />
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </div>

      {data.conversation.channel === "whatsapp" && (
        <InboxAiPanel conversationId={data.conversation.id} canSuggest={data.conversation.replyWindowOpen} onInsert={(text) => setInsert((p) => ({ id: (p?.id ?? 0) + 1, text }))} />
      )}
      {data.conversation.channel === "whatsapp" && <ReplyComposer conversationId={data.conversation.id} open={data.conversation.replyWindowOpen} savedReplies={savedReplies} insert={insert} />}
    </>
  );
}

const MEDIA_ICONS: Record<MediaKind, typeof FileText> = { image: ImageIcon, audio: Mic, video: Video, document: FileText, sticker: Smile };

const LEAD_STYLE: Record<LeadSignal, string> = {
  new_lead: "bg-sky-500/10 text-sky-700 dark:text-sky-400",
  active: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  needs_follow_up: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  customer: "bg-ringo-indigo/10 text-ringo-indigo",
  closed: "bg-ringo-muted/15 text-ringo-muted",
};

/** A derived, read-only label: where this conversation stands. It changes nothing. */
function LeadBadge({ signal }: { signal: LeadSignal }) {
  const { t } = useLanguage();
  return <span data-lead={signal} className={`rounded-full px-2 py-0.5 text-[10px] ${LEAD_STYLE[signal]}`}>{t.inbox.lead[signal]}</span>;
}

function Bubble({ m, conversationId, automatic = false }: { m: ThreadMessage; conversationId: string; automatic?: boolean }) {
  const { t, locale } = useLanguage();
  const u = t.inbox;
  const out = m.direction === "outbound";
  const d = m.display;
  // A message stuck in 'queued' for minutes is "not confirmed", never shown as sent or delivered.
  const statusLabel = m.unconfirmed ? u.unconfirmed : (u.statuses as Record<string, string>)[m.status];
  const Icon = d.kind === "media" ? MEDIA_ICONS[d.media] : null;
  return (
    <li className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm sm:max-w-[75%] ${out ? "rounded-br-md bg-ringo-indigo/10 text-ringo-text" : "rounded-bl-md border border-ringo-border bg-ringo-surface text-ringo-text"}`}>
        <span className="sr-only">{out ? u.direction.outbound : u.direction.inbound}: </span>
        {d.kind === "text" && <p className="whitespace-pre-wrap break-words">{d.text}</p>}
        {d.kind === "media" && Icon && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2.5 rounded-xl border border-ringo-border/70 bg-ringo-muted/10 p-2.5" data-media-kind={d.media}>
              <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-ringo-indigo/10 text-ringo-indigo">
                <Icon size={18} aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <p className="text-xs font-medium">{u.mediaKinds[d.media]}</p>
                {d.filename && <p className="break-all text-[11px] text-ringo-muted">{d.filename}</p>}
                {d.mimeType && <p className="break-all text-[10px] uppercase tracking-wide text-ringo-muted">{d.mimeType}</p>}
              </div>
            </div>
            {d.caption && <p className="whitespace-pre-wrap break-words">{d.caption}</p>}
            <p className="text-[11px] italic text-ringo-muted">{out ? (m.status === "failed" ? u.mediaOutboundFailed : u.mediaOutboundNote) : u.mediaNotDownloaded}</p>
          </div>
        )}
        {d.kind === "unsupported" && <p className="text-xs italic text-ringo-muted">{u.unsupported}</p>}
        <p className={`mt-1 flex items-center gap-1.5 text-[10px] text-ringo-muted ${out ? "justify-end" : ""}`}>
          <time dateTime={m.at} suppressHydrationWarning>{formatBubbleTime(m.at, locale)}</time>
          {out && automatic && <span data-automatic="true">· {u.autoReplyLabel}</span>}
          {out && statusLabel && <span className={m.status === "failed" ? "font-medium text-rose-700 dark:text-rose-400" : undefined}>· {statusLabel}</span>}
          {out && m.status === "failed" && d.kind === "text" && <RetryButton conversationId={conversationId} text={d.text} />}
        </p>
      </div>
    </li>
  );
}
