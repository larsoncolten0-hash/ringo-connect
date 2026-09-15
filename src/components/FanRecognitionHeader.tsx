"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { User, Check, BellRing, Loader2, Settings } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getPushStatus, subscribeToPush } from "@/lib/push/subscribeClient";
import MenuBackdrop from "@/components/ui/MenuBackdrop";
import ShareButton from "@/components/ShareButton";

// Purely client-side recognition of a returning community member — no
// server round trip just to decide whether to render this at all. Backed
// by the localStorage entry CommunityJoinPage.tsx writes right after a
// successful join: key "ringo-community-member-<username>", value
// { token, name }. Scoped per-profile by construction (the key includes
// the username), so being recognized on one creator's page never leaks
// into being recognized on another's.
//
// Never rendered for the profile owner's own view (see `isOwner`, computed
// server-side in src/app/[username]/page.tsx) or inside the dashboard's
// live preview (see `preview` in ProfileView.tsx, which simply doesn't
// mount this component at all there) — a real visitor's "you're a member"
// badge has no business appearing while the owner is just looking at their
// own page.
function storageKey(username: string) {
  return `ringo-community-member-${username}`;
}

type StoredMembership = { token: string; name: string };

function readMembership(username: string): StoredMembership | null {
  try {
    const raw = localStorage.getItem(storageKey(username));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed?.token === "string" && typeof parsed?.name === "string") return parsed;
    return null;
  } catch {
    // Corrupt value, or localStorage unavailable (private mode) — treat
    // exactly like "never joined" rather than throwing.
    return null;
  }
}

export default function FanRecognitionHeader({
  username,
  creatorName,
  accent,
  isOwner,
}: {
  username: string;
  creatorName: string;
  accent: string;
  isOwner: boolean;
}) {
  const { t } = useLanguage();
  const [membership, setMembership] = useState<StoredMembership | null>(null);
  const [open, setOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<"loading" | "unsupported" | "denied" | "off" | "on">("loading");
  const [pushBusy, setPushBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOwner) return;
    setMembership(readMembership(username));
  }, [username, isOwner]);

  useEffect(() => {
    if (!open) return;
    getPushStatus().then((s) =>
      setPushStatus(!s.supported ? "unsupported" : s.permission === "denied" ? "denied" : s.subscribed ? "on" : "off")
    );
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const enablePush = async () => {
    if (pushBusy || !membership || pushStatus !== "off") return;
    setPushBusy(true);
    const result = await subscribeToPush({ subscribeUrl: "/api/push/subscribe-subscriber", extra: { token: membership.token } });
    setPushStatus(result.ok ? "on" : "off");
    setPushBusy(false);
  };

  // Nothing stored for this profile, or this is the owner's own view —
  // render nothing at all, same "no dead UI" posture AddToHomeScreen.tsx
  // already uses.
  if (isOwner || !membership) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="h-9 flex items-center gap-1.5 pl-1.5 pr-3 rounded-full transition text-xs font-medium"
        style={{ backgroundColor: "rgba(255,255,255,0.7)", color: accent }}
      >
        <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}1a` }}>
          <User size={13} />
        </span>
        <span className="truncate max-w-[120px]">{t.communitySection.fanBadgeLabel(membership.name)}</span>
      </button>

      <AnimatePresence>
        {open && (
          <>
            <MenuBackdrop key="backdrop" onClose={() => setOpen(false)} className="z-10" />
            <motion.div
              key="panel"
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              transition={{ duration: 0.15 }}
              className="absolute top-11 right-0 w-64 rounded-2xl overflow-hidden z-20 text-sm"
              style={{ backgroundColor: "#FFFFFF", boxShadow: "0 16px 40px -12px rgba(0,0,0,0.3)" }}
            >
              <div className="px-3.5 py-3 border-b" style={{ borderColor: "#F3F4F6" }}>
                <p className="font-semibold" style={{ color: "#1F2937" }}>
                  {membership.name}
                </p>
                <p className="text-xs mt-0.5" style={{ color: "#6B7280" }}>
                  {t.communitySection.fanDropdownSubtitle(creatorName)}
                </p>
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                <span className="flex items-center gap-2" style={{ color: "#1F2937" }}>
                  <BellRing size={15} style={{ color: "#6B7280" }} />
                  {t.pushNotifications.hint}
                </span>
                {pushStatus !== "unsupported" && pushStatus !== "denied" && (
                  <button
                    onClick={enablePush}
                    disabled={pushBusy || pushStatus !== "off"}
                    className="shrink-0 flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full disabled:opacity-70"
                    style={pushStatus === "on" ? { backgroundColor: "#F0FDFA", color: "#0D9488" } : { backgroundColor: accent, color: "#fff" }}
                  >
                    {pushBusy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : pushStatus === "on" ? (
                      <Check size={12} />
                    ) : null}
                    {pushStatus === "on" ? t.pushNotifications.enabled : t.pushNotifications.enable}
                  </button>
                )}
                {pushStatus === "denied" && (
                  <span className="text-[11px] text-right" style={{ color: "#9CA3AF", maxWidth: 110 }}>
                    {t.pushNotifications.permissionDenied}
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-t" style={{ borderColor: "#F3F4F6" }}>
                <span style={{ color: "#1F2937" }}>{t.communitySection.fanShareLabel}</span>
                {/* Reuses the exact same ShareButton every other page uses
                    — its own trigger + menu, mounted inline here rather
                    than reimplementing the share options a second time. */}
                <ShareButton
                  accent={accent}
                  title={creatorName}
                  strings={{
                    share: t.profilePage.share,
                    copyLink: t.profilePage.copyLink,
                    linkCopied: t.profilePage.linkCopied,
                    shareWhatsapp: t.profilePage.shareWhatsapp,
                    shareFacebook: t.profilePage.shareFacebook,
                    shareX: t.profilePage.shareX,
                    moreOptions: t.profilePage.moreOptions,
                    showQrCode: t.profilePage.showQrCode,
                    qrCodeTitle: t.profilePage.qrCodeTitle,
                    qrCodeSubtitle: t.profilePage.qrCodeSubtitle,
                    qrCodeError: t.profilePage.qrCodeError,
                    downloadQrCode: t.profilePage.downloadQrCode,
                    close: t.profilePage.close,
                  }}
                />
              </div>

              <a
                href={`/community/manage/${membership.token}`}
                className="flex items-center gap-2 px-3.5 py-2.5 border-t transition hover:bg-black/[0.04]"
                style={{ borderColor: "#F3F4F6", color: "#1F2937" }}
              >
                <Settings size={15} style={{ color: "#6B7280" }} />
                {t.communityJoin.managePreferences}
              </a>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
