"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { LOCAL_SEND_EVENT, LOCAL_SEND_WINDOW_MS } from "@/lib/inbox/localSend";
import { anchorDelta, decideScroll, distanceFromBottom, isFarFromBottom, isNearBottom } from "@/lib/inbox/scrollPolicy";

// The ONE scrolling area of a conversation. Everything around it (the header above, the composer below) is fixed, so only the messages move.
//   * it opens on the newest message and keeps following the bottom ONLY while the person is already near it, or right after THEY sent something from this browser
//   * a message that arrives while they are reading older ones (from a customer, the Sales Bot, a colleague, another device, or the background refresh) does NOT move them:
//     a discreet "N new messages" button appears instead
//   * "Load earlier messages" adds older ones above and then restores the scroll position, so the message they were looking at stays where it was
//   * media that finishes loading (images, video frames) changes heights: while the reader is at the bottom it keeps them there; while they are reading older messages the
//     message they are looking at is kept exactly where it was (an anchor element, which also covers browsers without native scroll anchoring)
//   * the page quietly re-reads the conversation every 20 seconds while the tab is visible, which is how new customer messages appear; it never touches the composer
// All programmatic scrolls are instant (never animated), so prefers-reduced-motion is respected by construction.

const REFRESH_EVERY_MS = 20_000;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function ThreadScroller({
  conversationId,
  firstId,
  lastId,
  count,
  loadEarlierHref,
  children,
}: {
  conversationId: string;
  /** ids of the oldest and newest message currently shown, and how many there are: they tell the scroller what changed */
  firstId: string | null;
  lastId: string | null;
  count: number;
  /** present when older messages exist: the thread url asking for more */
  loadEarlierHref: string | null;
  children: React.ReactNode;
}) {
  const { t } = useLanguage();
  const u = t.inbox;
  const router = useRouter();
  const scroller = useRef<HTMLDivElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);
  const stick = useRef(true);
  const seen = useRef<{ firstId: string | null; lastId: string | null; count: number } | null>(null);
  const anchor = useRef<{ height: number; top: number } | null>(null);
  // when THIS browser last stored a send in this conversation (null = none pending)
  const localSentAt = useRef<number | null>(null);
  // the message the reader is looking at, and where it sits in the visible area (kept up to date while they scroll)
  const reading = useRef<{ el: HTMLElement; offset: number } | null>(null);
  const raf = useRef<number | null>(null);
  const [unseen, setUnseen] = useState(0);
  const [away, setAway] = useState(false);
  const [loadingEarlier, setLoadingEarlier] = useState(false);

  const toBottom = () => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  };

  function captureReading() {
    const el = scroller.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    for (const item of Array.from(el.querySelectorAll<HTMLElement>("[data-message-id]"))) {
      const r = item.getBoundingClientRect();
      if (r.bottom > top + 1) {
        reading.current = { el: item, offset: r.top - top };
        return;
      }
    }
    reading.current = null;
  }

  // A send made from THIS browser claims the next new message (see localSend.ts); nothing else ever does.
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent).detail?.conversationId === conversationId) localSentAt.current = Date.now();
    };
    window.addEventListener(LOCAL_SEND_EVENT, on);
    return () => window.removeEventListener(LOCAL_SEND_EVENT, on);
  }, [conversationId]);

  // What changed since the last render decides what the scroll position does (the rules live in lib/inbox/scrollPolicy.ts).
  useIsoLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const next = { firstId, lastId, count };
    const local = localSentAt.current !== null && Date.now() - localSentAt.current < LOCAL_SEND_WINDOW_MS;
    const d = decideScroll({ prev: seen.current, next, stick: stick.current, localSend: local, anchor: anchor.current, scrollHeight: el.scrollHeight });
    if (seen.current && seen.current.lastId !== lastId) localSentAt.current = null;
    if (d.action === "bottom") {
      toBottom();
      stick.current = true;
      setUnseen(0);
      setAway(false);
    } else if (d.action === "restore") {
      el.scrollTop = d.top;
      anchor.current = null;
      setLoadingEarlier(false);
    } else if (d.action === "unseen") {
      setUnseen((n) => n + d.added);
    }
    seen.current = next;
    captureReading();
  }, [firstId, lastId, count]);

  function onScroll() {
    const el = scroller.current;
    if (!el) return;
    const gap = distanceFromBottom(el);
    const near = isNearBottom(gap);
    stick.current = near;
    if (near) setUnseen((n) => (n === 0 ? n : 0));
    const far = isFarFromBottom(gap);
    setAway((a) => (a === far ? a : far));
    if (raf.current === null) {
      raf.current = window.requestAnimationFrame(() => {
        raf.current = null;
        captureReading();
      });
    }
  }

  // Late-loading media, a growing composer or a resized window change the heights. At the bottom the reader stays at the bottom; anywhere else the message they are reading stays
  // exactly where it was.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (stick.current) return toBottom();
      const r = reading.current;
      if (!r || !r.el.isConnected) return;
      const delta = anchorDelta(r.offset, r.el.getBoundingClientRect().top - el.getBoundingClientRect().top);
      if (delta !== 0) el.scrollTop += delta;
    });
    ro.observe(inner);
    ro.observe(el);
    return () => {
      ro.disconnect();
      if (raf.current !== null) window.cancelAnimationFrame(raf.current);
    };
  }, []);

  // New customer messages arrive by re-reading the (server rendered) conversation, only while the tab is in front.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    const id = window.setInterval(tick, REFRESH_EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [router]);

  // a "Load earlier" that never produced anything must not leave the button disabled for ever
  useEffect(() => {
    if (!loadingEarlier) return;
    const id = window.setTimeout(() => {
      anchor.current = null;
      setLoadingEarlier(false);
    }, 10_000);
    return () => window.clearTimeout(id);
  }, [loadingEarlier]);

  function loadEarlier() {
    const el = scroller.current;
    if (!el || !loadEarlierHref || loadingEarlier) return;
    anchor.current = { height: el.scrollHeight, top: el.scrollTop };
    setLoadingEarlier(true);
    router.replace(loadEarlierHref, { scroll: false });
  }

  function jumpToLatest() {
    stick.current = true;
    setUnseen(0);
    setAway(false);
    toBottom();
  }

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="absolute inset-0 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
        data-testid="thread-scroll"
        role="log"
        aria-label={u.messagesLabel}
        aria-live="off"
        tabIndex={0}
      >
        <div ref={content}>
          {loadEarlierHref && (
            <div className="mb-3 text-center">
              <button
                type="button"
                onClick={loadEarlier}
                disabled={loadingEarlier}
                className="rounded-full border border-ringo-border px-3.5 py-1.5 text-[11px] font-medium text-ringo-text transition-colors hover:bg-ringo-surface disabled:opacity-60"
                data-testid="load-earlier"
              >
                {loadingEarlier ? u.loadingEarlier : u.loadEarlier}
              </button>
            </div>
          )}
          {children}
        </div>
      </div>
      {(unseen > 0 || away) && (
        <button
          type="button"
          onClick={jumpToLatest}
          className="absolute bottom-3 left-1/2 inline-flex min-h-[36px] -translate-x-1/2 items-center gap-1.5 rounded-full border border-ringo-border bg-ringo-surface px-3.5 py-1.5 text-xs font-medium text-ringo-text shadow-sm transition-colors hover:bg-ringo-bg focus-visible:outline focus-visible:outline-2 focus-visible:outline-ringo-indigo"
          data-testid="jump-to-latest"
        >
          <ArrowDown size={14} aria-hidden="true" />
          {unseen > 0 ? u.newMessages(unseen) : u.jumpToLatest}
        </button>
      )}
      <p role="status" aria-live="polite" className="sr-only">{unseen > 0 ? u.newMessages(unseen) : ""}</p>
    </div>
  );
}
