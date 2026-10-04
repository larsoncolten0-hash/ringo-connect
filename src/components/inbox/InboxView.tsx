"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { ArrowLeft, MessageCircle, MessagesSquare, TriangleAlert } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ConversationItem, ThreadData, ThreadMessage } from "@/lib/inbox/data";
import { formatBubbleTime, formatListTime, formatWaId, previewText } from "@/lib/inbox/format";

// The Inbox screen (read-only). All data arrives as props from the server pages (already scoped to the owner's profile); this component
// only renders it. Customer text is rendered as plain React text children (escaped), never as HTML.
//
// Responsive: below `lg` it is a single pane. The conversation list is shown on /dashboard/inbox and the thread on
// /dashboard/inbox/<id> with a back link. From `lg` up both panes show side by side.

export type InboxViewProps = {
  list: { ok: true; items: ConversationItem[]; truncated?: boolean } | { ok: false };
  selectedId: string | null;
  thread: { ok: true; thread: ThreadData } | { ok: false; reason: "not_found" | "error" } | null;
};

export const INBOX_PATH = "/dashboard/inbox";

export default function InboxView({ list, selectedId, thread }: InboxViewProps) {
  const { t } = useLanguage();
  const u = t.inbox;
  const hasSelection = selectedId !== null;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text">{u.title}</h1>
        <p className="mt-1 text-sm text-ringo-muted">{u.intro}</p>
      </div>

      {!list.ok ? (
        <ErrorPanel />
      ) : (
        <div className="grid gap-4 lg:h-[calc(100dvh-13rem)] lg:min-h-[480px] lg:grid-cols-[340px_minmax(0,1fr)]">
          <section aria-label={u.conversations} className={`${hasSelection ? "hidden lg:flex" : "flex"} min-h-0 flex-col overflow-hidden rounded-card border border-ringo-border`}>
            <h2 className="border-b border-ringo-border px-4 py-3 text-xs font-semibold uppercase tracking-wider text-ringo-muted">{u.conversations}</h2>
            {list.items.length === 0 ? <EmptyList /> : <ConversationList items={list.items} selectedId={selectedId} truncated={list.truncated === true} />}
          </section>

          <section className={`${hasSelection ? "flex" : "hidden lg:flex"} min-h-0 flex-col overflow-hidden rounded-card border border-ringo-border`}>
            {thread === null ? <NoSelection /> : thread.ok ? <Thread data={thread.thread} /> : thread.reason === "not_found" ? <NotFound /> : <ErrorPanel inPane retryHref={`${INBOX_PATH}/${selectedId}`} />}
          </section>
        </div>
      )}
    </div>
  );
}

function EmptyList() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
      <MessagesSquare size={22} className="mb-2 text-ringo-muted" aria-hidden="true" />
      <p className="text-sm font-medium text-ringo-text">{t.inbox.emptyTitle}</p>
      <p className="text-xs text-ringo-muted">{t.inbox.emptyBody}</p>
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

function NotFound() {
  const { t } = useLanguage();
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <p className="text-sm font-medium text-ringo-text">{t.inbox.threadNotFoundTitle}</p>
      <p className="text-xs text-ringo-muted">{t.inbox.threadNotFoundBody}</p>
      <Link href={INBOX_PATH} className="text-xs font-medium text-ringo-indigo hover:underline lg:hidden">{t.inbox.back}</Link>
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

function ConversationList({ items, selectedId, truncated }: { items: ConversationItem[]; selectedId: string | null; truncated: boolean }) {
  const { t, locale } = useLanguage();
  const u = t.inbox;
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
              href={`${INBOX_PATH}/${c.id}`}
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

function Thread({ data }: { data: ThreadData }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const endRef = useRef<HTMLDivElement | null>(null);
  // open on the newest message
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [data.conversation.id, data.messages.length]);

  const name = data.contact.name || u.unknownContact;
  return (
    <>
      <header className="flex items-center gap-3 border-b border-ringo-border px-4 py-3">
        <Link href={INBOX_PATH} aria-label={u.back} className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-surface hover:text-ringo-text lg:hidden">
          <ArrowLeft size={18} aria-hidden="true" />
        </Link>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-medium text-ringo-text">{name}</h2>
          <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-ringo-muted">
            <ChannelBadge channel={data.conversation.channel} />
            {data.contact.waId && <span>{formatWaId(data.contact.waId)}</span>}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] ${data.conversation.status === "open" ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "bg-ringo-muted/15 text-ringo-muted"}`}>
          {data.conversation.status === "open" ? u.open : u.closed}
        </span>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" data-testid="thread-scroll">
        {data.truncated && <p className="mb-3 text-center text-[11px] text-ringo-muted">{u.threadLimited(data.messages.length)}</p>}
        {data.messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-ringo-muted">{u.noMessages}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {data.messages.map((m) => (
              <Bubble key={m.id} m={m} />
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </div>
    </>
  );
}

function Bubble({ m }: { m: ThreadMessage }) {
  const { t, locale } = useLanguage();
  const u = t.inbox;
  const out = m.direction === "outbound";
  const d = m.display;
  return (
    <li className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm sm:max-w-[75%] ${out ? "rounded-br-md bg-ringo-indigo/10 text-ringo-text" : "rounded-bl-md border border-ringo-border bg-ringo-surface text-ringo-text"}`}>
        <span className="sr-only">{out ? u.direction.outbound : u.direction.inbound}: </span>
        {d.kind === "text" && <p className="whitespace-pre-wrap break-words">{d.text}</p>}
        {d.kind === "media" && (
          <div className="flex flex-col gap-0.5">
            <p className="text-xs font-medium">{u.mediaKinds[d.media]}</p>
            {d.filename && <p className="break-all text-xs text-ringo-muted">{d.filename}</p>}
            {d.caption && <p className="whitespace-pre-wrap break-words">{d.caption}</p>}
            <p className="text-[11px] italic text-ringo-muted">{u.mediaNotDownloaded}</p>
          </div>
        )}
        {d.kind === "unsupported" && <p className="text-xs italic text-ringo-muted">{u.unsupported}</p>}
        <p className={`mt-1 flex items-center gap-1.5 text-[10px] text-ringo-muted ${out ? "justify-end" : ""}`}>
          <time dateTime={m.at} suppressHydrationWarning>{formatBubbleTime(m.at, locale)}</time>
          {out && (u.statuses as Record<string, string>)[m.status] && <span>· {(u.statuses as Record<string, string>)[m.status]}</span>}
        </p>
      </div>
    </li>
  );
}
