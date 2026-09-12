"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Music, Play, ShoppingBag, Ticket, Heart, ShoppingCart, UtensilsCrossed, MapPin, Phone, CalendarDays, Store, Wrench, Mail, Check, Nfc } from "lucide-react";
import { FaWhatsapp, FaInstagram, FaTiktok, FaYoutube } from "react-icons/fa6";
import PhoneMockup from "./PhoneMockup";
import { useLanguage } from "@/components/LanguageProvider";

type Tab = "artist" | "restaurant" | "business" | "card";

// The hero's product demonstration — real Ringo colors and layout
// patterns (the Music & Entertainment and Restaurant & Food recommended
// themes, exactly as they render on an actual profile), not a generic
// illustration. Static mockup content, not live data — see the section
// comment in LandingView.tsx for why.
export default function IndustryShowcase() {
  const { t } = useLanguage();
  const [tab, setTab] = useState<Tab>("artist");
  const reduceMotion = useReducedMotion();

  const tabs: { id: Tab; label: string }[] = [
    { id: "artist", label: t.landing.heroShowcaseArtist },
    { id: "restaurant", label: t.landing.heroShowcaseRestaurant },
    { id: "business", label: t.landing.heroShowcaseBusiness },
    { id: "card", label: t.landing.heroShowcaseCard },
  ];

  return (
    <div className="flex flex-col items-center gap-4">
      <PhoneMockup>
        <AnimatePresence mode="wait">
          <motion.div
            key={tab}
            initial={reduceMotion ? { opacity: 1 } : { opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, x: -12 }}
            transition={{ duration: 0.25 }}
            className="h-full"
          >
            {tab === "artist" && <ArtistMockup />}
            {tab === "restaurant" && <RestaurantMockup />}
            {tab === "business" && <BusinessMockup />}
            {tab === "card" && <RingoCardMockup />}
          </motion.div>
        </AnimatePresence>
      </PhoneMockup>

      <div className="flex items-center gap-1 bg-ringo-muted/10 rounded-full p-1">
        {tabs.map((tb) => (
          <button
            key={tb.id}
            onClick={() => setTab(tb.id)}
            className={`text-xs font-medium px-4 py-1.5 rounded-full transition ${
              tab === tb.id ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"
            }`}
          >
            {tb.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-ringo-muted">{t.landing.heroShowcaseCaption}</p>
    </div>
  );
}

// --- Artist — same dark/gold palette as the real Music & Entertainment theme ---
function ArtistMockup() {
  const gold = "#F2B705";
  return (
    <div className="h-full flex flex-col items-center px-4 pt-9 pb-6 text-center" style={{ background: "linear-gradient(180deg, #0B0B12, #1A1220)", color: "#FAFAFA" }}>
      <span className="w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold" style={{ backgroundColor: `${gold}22`, color: gold, border: `2px solid ${gold}` }}>
        JK
      </span>
      <p className="font-display font-bold text-sm mt-2.5 flex items-center gap-1">
        JAY KAY <span className="text-xs">🎵</span>
      </p>
      <p className="text-[11px] mt-0.5" style={{ opacity: 0.65 }}>
        Artist • Cameroon 🇨🇲
      </p>
      <div className="flex gap-1.5 mt-2.5">
        <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: "#25D36622" }}>
          <FaWhatsapp size={12} color="#25D366" />
        </span>
        <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: `${gold}18` }}>
          <FaInstagram size={12} color={gold} />
        </span>
        <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: `${gold}18` }}>
          <FaTiktok size={12} color={gold} />
        </span>
        <span className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: `${gold}18` }}>
          <FaYoutube size={12} color={gold} />
        </span>
      </div>

      <div className="w-full mt-4 rounded-2xl bg-[#171009] p-2.5 flex items-center gap-2.5 text-left">
        <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${gold}22` }}>
          <Play size={14} style={{ color: gold }} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold truncate">My Era</p>
          <p className="text-[9px]" style={{ opacity: 0.6 }}>
            Latest release
          </p>
        </div>
      </div>

      <div className="w-full mt-3 flex flex-col gap-1.5">
        {[
          { icon: ShoppingBag, label: "Music Store" },
          { icon: Ticket, label: "Get Tickets" },
          { icon: Heart, label: "Gift the Artist" },
        ].map((row) => (
          <div key={row.label} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ border: "1px solid rgba(255,255,255,0.1)" }}>
            <row.icon size={12} style={{ color: gold }} />
            <span className="text-[11px] font-medium">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// --- Restaurant — same white/green palette as the real Restaurant & Food theme ---
function RestaurantMockup() {
  const green = "#1F9D55";
  return (
    <div className="h-full flex flex-col items-center px-4 pt-9 pb-6 text-center bg-white" style={{ color: "#14202B" }}>
      <span className="w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold" style={{ backgroundColor: `${green}18`, color: green, border: `2px solid ${green}` }}>
        AR
      </span>
      <p className="font-display font-bold text-sm mt-2.5">ABC RESTAURANT</p>
      <p className="text-[11px] mt-0.5" style={{ opacity: 0.6 }}>
        Restaurant • Yaoundé
      </p>

      <div className="flex gap-1.5 mt-3 w-full">
        <span className="flex-1 flex items-center justify-center gap-1 py-2 rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: green }}>
          <UtensilsCrossed size={11} /> View Menu
        </span>
        <span className="flex-1 flex items-center justify-center gap-1 py-2 rounded-full text-[11px] font-semibold text-white" style={{ backgroundColor: green }}>
          <ShoppingCart size={11} /> Order
        </span>
      </div>

      <div className="flex gap-3 mt-3">
        {[FaWhatsapp, MapPin, Phone, CalendarDays].map((Icon, i) => (
          <span key={i} className="w-7 h-7 rounded-full flex items-center justify-center" style={{ backgroundColor: `${green}14`, color: green }}>
            <Icon size={12} />
          </span>
        ))}
      </div>

      <div className="w-full mt-4 text-left">
        <p className="text-[10px] font-bold mb-1.5">Today's Special</p>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid #E5E7EB" }}>
          <div className="w-full h-16" style={{ backgroundColor: "#F3F4F6" }} />
          <div className="p-2">
            <p className="text-[11px] font-semibold">Grilled Chicken</p>
            <p className="text-[11px] font-bold" style={{ color: green }}>
              5,000 FCFA
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// --- Business — the default Ringo theme (dark, gold outline) ---
function BusinessMockup() {
  const gold = "#D4A954";
  return (
    <div className="h-full flex flex-col items-center px-4 pt-9 pb-6 text-center" style={{ backgroundColor: "#0A0A0A", color: "#FAFAFA" }}>
      <span className="w-16 h-16 rounded-full flex items-center justify-center text-lg font-bold" style={{ border: `2px solid ${gold}`, color: gold }}>
        MB
      </span>
      <p className="font-display font-bold text-sm mt-2.5">MY BUSINESS</p>
      <p className="text-[11px] mt-0.5" style={{ opacity: 0.65 }}>
        Douala • Cameroon
      </p>

      <div className="w-full mt-4 flex flex-col gap-1.5">
        {[
          { icon: Store, label: "Shop" },
          { icon: Wrench, label: "Services" },
          { icon: Mail, label: "Contact" },
        ].map((row) => (
          <div key={row.label} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ border: `2px solid ${gold}` }}>
            <row.icon size={12} style={{ color: gold }} />
            <span className="text-[11px] font-medium">{row.label}</span>
          </div>
        ))}
        <div className="flex items-center justify-center gap-1.5 rounded-xl px-2.5 py-2" style={{ backgroundColor: "#25D366", color: "#fff" }}>
          <FaWhatsapp size={12} />
          <span className="text-[11px] font-medium">WhatsApp</span>
        </div>
      </div>
    </div>
  );
}

// --- Ringo Card — not the physical card itself, but what actually shows
// up on a customer's phone right after they tap it: the success moment,
// then the profile it opened into. Same dark/gold default Ringo theme as
// BusinessMockup, since a physical card can be paired with any account ---
function RingoCardMockup() {
  const gold = "#D4A954";
  return (
    <div className="h-full flex flex-col items-center px-4 pt-9 pb-6 text-center" style={{ backgroundColor: "#0A0A0A", color: "#FAFAFA" }}>
      <span className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${gold}22`, border: `2px solid ${gold}` }}>
        <Check size={24} style={{ color: gold }} />
      </span>
      <p className="font-display font-bold text-sm mt-2.5">Card Scanned</p>
      <p className="text-[11px] mt-0.5" style={{ opacity: 0.65 }}>
        Opening MY BUSINESS…
      </p>

      <div className="w-full mt-5 rounded-2xl p-2.5 flex items-center gap-2.5 text-left" style={{ border: `1px solid ${gold}55` }}>
        <span className="w-11 h-11 rounded-xl flex items-center justify-center shrink-0" style={{ border: `2px solid ${gold}`, color: gold }}>
          <Nfc size={16} />
        </span>
        <div className="min-w-0">
          <p className="text-[11px] font-semibold truncate">Ringo Card</p>
          <p className="text-[9px]" style={{ opacity: 0.6 }}>
            One tap. Instant profile.
          </p>
        </div>
      </div>

      <div className="w-full mt-4 flex flex-col gap-1.5">
        {[
          { icon: Store, label: "Shop" },
          { icon: Wrench, label: "Services" },
          { icon: Mail, label: "Contact" },
        ].map((row) => (
          <div key={row.label} className="flex items-center gap-2 rounded-xl px-2.5 py-2" style={{ border: `2px solid ${gold}` }}>
            <row.icon size={12} style={{ color: gold }} />
            <span className="text-[11px] font-medium">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
