"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { LOCALE_META, SUPPORTED_LOCALES, listboxNextIndex } from "@/lib/i18n/locales";
import { TAP_AREA_36 } from "@/components/ui/menuNav";

// A compact language picker for PUBLIC pages: "[ EN ▾ ]" that opens a small list
// of every supported language (English, Français, …). It only ever calls the
// existing LanguageProvider's setLocale, so the choice is stored in the same
// place as everywhere else in the app (localStorage "ringo-lang") and every
// public page — main profile, restaurant, music store, item pages, booking —
// follows it without any per-page state, URL change or reload. It reads and
// writes no profile content, touches no route, and never renders inside the
// dashboard editor preview (the parent decides).
//
// Accessibility: a button with aria-haspopup="listbox" / aria-expanded and an
// explicit accessible name; the popup is a listbox of options with aria-selected
// and aria-activedescendant. Keyboard: Enter/Space/ArrowDown/ArrowUp open it;
// Arrow keys, Home and End move; Enter or Space chooses; Escape closes and
// returns focus to the button; Tab or clicking outside closes it. Touch targets
// are 44px (the visible button stays 36px; the tappable area is extended invisibly).
//
// `variant` only changes colours so it sits naturally on each kind of surface:
//   "glass"   — over a profile's cover photo, matching the frosted share button;
//   "bar"     — in the white header bar of a sub-page;
//   "overlay" — over a hero image on dark frosted glass.
type Variant = "glass" | "bar" | "overlay";

export default function PublicLanguageSelector({ variant = "bar", accent, className = "" }: { variant?: Variant; accent?: string; className?: string }) {
  const { locale, setLocale, t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const currentIndex = Math.max(0, SUPPORTED_LOCALES.indexOf(locale));

  const openMenu = () => {
    setActive(currentIndex);
    setOpen(true);
  };
  const closeMenu = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  };
  const choose = (index: number) => {
    setLocale(SUPPORTED_LOCALES[index]);
    closeMenu(true);
  };

  // Move focus into the list when it opens so the arrow keys work immediately.
  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  // Close on a click/tap anywhere else.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const onButtonKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      openMenu();
    }
  };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu(true);
    } else if (e.key === "Tab") {
      setOpen(false);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      choose(active);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      e.preventDefault();
      setActive((a) => listboxNextIndex(e.key, a, SUPPORTED_LOCALES.length));
    }
  };

  const buttonStyle: React.CSSProperties =
    variant === "glass"
      ? { backgroundColor: "rgba(255,255,255,0.7)", color: accent || "#14202B" }
      : variant === "overlay"
        ? { backgroundColor: "rgba(15,15,20,0.42)", color: "#fff" }
        : { borderColor: "#E5E7EB", color: "#14202B" };

  const label = `${t.profilePage.languageLabel}: ${LOCALE_META[locale].label}`;

  return (
    <div ref={rootRef} className={`relative shrink-0 ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        title={label}
        onClick={() => (open ? closeMenu(false) : openMenu())}
        onKeyDown={onButtonKeyDown}
        style={buttonStyle}
        className={`inline-flex h-9 min-w-[3rem] items-center justify-center gap-1 rounded-full px-2.5 text-xs font-semibold tracking-wide transition active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current ${TAP_AREA_36} ${
          variant === "bar" ? "border bg-transparent hover:bg-black/5" : "backdrop-blur-md"
        }`}
      >
        <span aria-hidden="true">{LOCALE_META[locale].short}</span>
        <ChevronDown size={12} aria-hidden="true" className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={-1}
          aria-label={t.profilePage.languageLabel}
          aria-activedescendant={`${listId}-${SUPPORTED_LOCALES[active]}`}
          onKeyDown={onListKeyDown}
          className="absolute right-0 top-full z-40 mt-1.5 min-w-[9rem] rounded-xl border bg-white p-1 shadow-lg outline-none"
          style={{ borderColor: "#E5E7EB", color: "#14202B" }}
        >
          {SUPPORTED_LOCALES.map((code, i) => (
            <li
              key={code}
              id={`${listId}-${code}`}
              role="option"
              lang={code}
              aria-selected={code === locale}
              onClick={() => choose(i)}
              onMouseEnter={() => setActive(i)}
              className={`flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg px-3 text-sm ${i === active ? "bg-black/5" : ""}`}
            >
              <span>{LOCALE_META[code].label}</span>
              {code === locale && <Check size={14} aria-hidden="true" />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
