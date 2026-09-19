"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck, ChevronDown, Loader2, LogOut, MailQuestion, User } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import CustomerAvatar from "./CustomerAvatar";
import ConfirmEmailDialog from "./ConfirmEmailDialog";
import { signOutCustomer } from "./signOut";

// The avatar menu (top-right on phones, bottom of the sidebar on desktop).
// Confirming the email is OPTIONAL and clearly presented that way: the account
// works identically whether it's confirmed or not, so it's an entry in this menu,
// never a blocker or a nag.
export default function AccountMenu({
  customer,
  variant,
}: {
  customer: { name: string; avatarUrl: string | null; email: string; emailConfirmed: boolean };
  variant: "top" | "side";
}) {
  const { t } = useLanguage();
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(customer.emailConfirmed);
  const [signingOut, setSigningOut] = useState(false);
  const a = t.myRingo.account;

  // Server data can change (e.g. after router.refresh()); keep the flag in step.
  useEffect(() => setConfirmed(customer.emailConfirmed), [customer.emailConfirmed]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const panelPosition = variant === "top" ? "right-0 top-full mt-2" : "bottom-full left-0 mb-2";
  const itemClass = "flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-medium transition hover:bg-ringo-muted/10";

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={a.menu}
        aria-haspopup="menu"
        aria-expanded={open}
        className={
          variant === "top"
            ? "flex items-center gap-1 rounded-full p-0.5 transition hover:bg-ringo-muted/10"
            : "flex w-full items-center gap-2.5 rounded-xl p-2 text-left transition hover:bg-ringo-muted/10"
        }
      >
        <CustomerAvatar name={customer.name} avatarUrl={customer.avatarUrl} className={variant === "top" ? "w-8 h-8 text-[11px]" : "w-9 h-9 text-xs"} />
        {variant === "side" && (
          <>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{customer.name}</span>
            <ChevronDown size={15} className={`shrink-0 text-ringo-muted transition ${open ? "rotate-180" : ""}`} />
          </>
        )}
      </button>

      {open && (
        <div
          role="menu"
          className={`absolute z-50 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-ringo-border/70 bg-ringo-surface p-2 shadow-[0_8px_30px_-6px_rgba(15,23,42,0.2)] ${panelPosition}`}
        >
          <div className="px-3 pb-2 pt-2.5">
            <p className="truncate text-sm font-semibold text-ringo-text">{customer.name}</p>
            <p className="truncate text-xs text-ringo-muted">{customer.email}</p>
            <p
              className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                confirmed ? "bg-emerald-500/10 text-emerald-600" : "bg-ringo-muted/15 text-ringo-muted"
              }`}
            >
              {confirmed ? <BadgeCheck size={11} /> : <MailQuestion size={11} />}
              {confirmed ? a.emailConfirmed : a.emailNotConfirmed}
            </p>
          </div>

          <div className="border-t border-ringo-border/60 pt-1">
            {!confirmed && (
              <div className="pb-1">
                <button
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    setConfirming(true);
                  }}
                  className={`${itemClass} text-ringo-indigo`}
                >
                  <MailQuestion size={16} />
                  {a.confirmEmail}
                </button>
                <p className="px-3 pb-1 text-[11px] text-ringo-muted">{a.optionalNote}</p>
              </div>
            )}
            <Link role="menuitem" href="/my-ringo/me" onClick={() => setOpen(false)} className={`${itemClass} text-ringo-text`}>
              <User size={16} />
              {a.myProfile}
            </Link>
            <button
              role="menuitem"
              onClick={async () => {
                if (signingOut) return;
                setSigningOut(true);
                await signOutCustomer();
              }}
              disabled={signingOut}
              className={`${itemClass} text-red-600 disabled:opacity-60`}
            >
              {signingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
              {signingOut ? t.myRingo.me.loggingOut : t.myRingo.me.logout}
            </button>
          </div>
        </div>
      )}

      {confirming && (
        <ConfirmEmailDialog
          email={customer.email}
          onClose={() => setConfirming(false)}
          onConfirmed={() => {
            setConfirmed(true);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
