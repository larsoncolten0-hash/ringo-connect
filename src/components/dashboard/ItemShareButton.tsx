"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Check, Link2, Megaphone, Share2 } from "lucide-react";
import { FaWhatsapp } from "react-icons/fa6";
import { useLanguage } from "@/components/LanguageProvider";
import { isShareableId, itemUrl, type ShareableKind } from "@/lib/deepLinks";

// A small "Share" control for any single thing a creator has added (merch, song, EP/album, ticket
// event, menu item, service). It shares that item's OWN page (see lib/deepLinks.ts), never the
// whole profile: copy link, WhatsApp, the device share sheet, or "Share to community", which
// opens the announcement composer already filled with the item's link and title.
//
// The profile + site URL come from an <ItemShareProvider> higher up the tree (the editor, the
// booking settings, the tickets list), so rows don't need them threaded through as props.

type ShareContext = { profile: { username: string; category?: string | null; categories?: string[] | null }; siteUrl?: string | null };
const Ctx = createContext<ShareContext | null>(null);

export function ItemShareProvider({ profile, siteUrl, children }: ShareContext & { children: React.ReactNode }) {
  return <Ctx.Provider value={{ profile, siteUrl }}>{children}</Ctx.Provider>;
}

export default function ItemShareButton({
  kind,
  id,
  title,
  imageUrl,
  className = "",
}: {
  kind: ShareableKind;
  id: string | null | undefined;
  title: string;
  imageUrl?: string | null;
  className?: string;
}) {
  const ctx = useContext(Ctx);
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [canNativeShare, setCanNativeShare] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCanNativeShare(typeof navigator !== "undefined" && !!navigator.share);
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Nothing to share until the item exists (an unsaved row has no id yet).
  if (!ctx || !isShareableId(id)) return null;

  const s = t.itemShare;
  const url = itemUrl(ctx.profile, kind, id, ctx.siteUrl);
  const name = title.trim();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the WhatsApp / share-sheet options still work.
    }
  };

  const communityHref = `/dashboard/community/announcements/new?${new URLSearchParams({
    link: url,
    ...(name ? { title: name } : {}),
    ...(imageUrl ? { image: imageUrl } : {}),
  }).toString()}`;

  const row = "flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-medium text-ringo-text hover:bg-ringo-muted/10";

  return (
    <div ref={ref} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={s.share}
        title={s.share}
        aria-expanded={open}
        className="p-1 text-ringo-muted transition hover:text-ringo-indigo"
      >
        <Share2 size={14} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-card border border-ringo-border bg-ringo-surface py-1 shadow-lg">
          <button type="button" onClick={copy} className={row}>
            {copied ? <Check size={14} className="text-ringo-teal" /> : <Link2 size={14} />}
            {copied ? s.linkCopied : s.copyLink}
          </button>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(name ? `${name} ${url}` : url)}`}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
            className={row}
          >
            <FaWhatsapp size={14} color="#25D366" />
            {s.whatsapp}
          </a>
          {canNativeShare && (
            <button
              type="button"
              onClick={() => {
                navigator.share({ title: name || undefined, url }).catch(() => {});
                setOpen(false);
              }}
              className={row}
            >
              <Share2 size={14} />
              {s.moreOptions}
            </button>
          )}
          <Link href={communityHref} onClick={() => setOpen(false)} className={`${row} border-t border-ringo-border/60`}>
            <Megaphone size={14} className="text-ringo-indigo" />
            {s.toCommunity}
          </Link>
        </div>
      )}
    </div>
  );
}
