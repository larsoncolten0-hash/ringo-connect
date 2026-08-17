"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Copy, Check, MapPin, ChevronRight, ChevronDown, ShoppingBag, Mail, Phone, Clock } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { hexToRgba } from "@/lib/color";
import { getButtonStyle, getRadiusClass, getBackgroundStyle } from "@/lib/theme";
import WhatsAppButton from "./WhatsAppButton";
import CallButton from "./CallButton";
import SocialIcon from "./SocialIcon";

export default function ProfileView({ profile }: { profile: any }) {
  const { t } = useLanguage();
  const [copied, setCopied] = useState(false);
  const [showCatalog, setShowCatalog] = useState(true);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API can fail (older browsers, non-HTTPS) — fail silently
      // rather than showing an error for a non-critical convenience feature.
    }
  };

  const logClick = async (targetType: "link" | "product" | "whatsapp", targetId?: string) => {
    try {
      const res = await fetch("/api/track", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileId: profile.id, targetType, targetId: targetId ?? null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        console.error("Track request failed:", res.status, body);
      }
    } catch (err) {
      console.error("Track request errored:", err);
    }
  };

  const accent = profile.theme_color || "#D4A954";
  const textColor = profile.text_color || "#FAFAFA";
  const bgColor = profile.background_color || "#0A0A0A";
  const radiusClass = getRadiusClass(profile.button_radius || "rounded");
  const linkButtonStyle = getButtonStyle(profile.button_style || "outline", accent);
  const borderTint = hexToRgba(textColor, 0.12);

  // The public page is the creator's brand, not app chrome — it renders
  // with exactly the colors they chose, independent of the visitor's own
  // dark mode preference (unlike the dashboard, which does follow it).
  const pageStyle = {
    ...getBackgroundStyle(profile.background_style || "solid", bgColor, profile.background_gradient_end),
    color: textColor,
    ["--theme" as any]: accent,
  };

  // First word gets the page's default text color, the rest picks up the
  // accent — matches the two-tone name treatment in the reference design.
  // A single-word name just renders plain, no accent applied to nothing.
  const nameParts = (profile.name || "").trim().split(/\s+/);
  const firstName = nameParts[0] || "";
  const restName = nameParts.slice(1).join(" ");

  return (
    <main className="relative min-h-screen flex flex-col items-center pb-10" style={pageStyle}>
      {/* Cover photo — falls back to a soft accent-tinted gradient when
          the creator hasn't uploaded one, rather than an empty/broken area. */}
      <div className="relative w-full h-52 sm:h-60 overflow-hidden shrink-0">
        {profile.cover_image_url ? (
          <img src={profile.cover_image_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <div
            className="w-full h-full"
            style={{ background: `linear-gradient(135deg, ${hexToRgba(accent, 0.35)}, ${bgColor})` }}
          />
        )}
        <div
          className="absolute inset-0"
          style={{ background: `linear-gradient(to bottom, transparent 35%, ${bgColor} 92%)` }}
        />

        <button
          onClick={copyLink}
          aria-label="Copy link to this page"
          className="absolute top-4 right-4 w-9 h-9 rounded-full flex items-center justify-center transition z-10"
          style={{ backgroundColor: "rgba(255,255,255,0.7)", color: accent }}
        >
          {copied ? <Check size={15} /> : <Copy size={15} />}
        </button>
        <AnimatePresence>
          {copied && (
            <motion.span
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="absolute top-14 right-4 text-xs px-2.5 py-1 rounded-full z-10"
              style={{ backgroundColor: "rgba(255,255,255,0.9)", color: accent }}
            >
              {t.profilePage.linkCopied}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <div className="relative z-10 flex flex-col items-center px-4 -mt-16 w-full">
        <div className="relative animate-fade-up">
          {/* Subtle pulsing glow — the same ring-pulse signature used on
              the auth pages, scaled down and tinted to the creator's own
              accent color rather than the fixed brand palette. */}
          <span
            className="absolute inset-0 rounded-full animate-ring-pulse-1 pointer-events-none"
            style={{ border: `2px solid ${accent}` }}
          />
          <span
            className="absolute inset-0 rounded-full animate-ring-pulse-2 pointer-events-none"
            style={{ border: `2px solid ${accent}` }}
          />
          <img
            src={profile.avatar_url || "/default-avatar.png"}
            alt={profile.name}
            className="relative w-36 h-36 sm:w-40 sm:h-40 rounded-full object-cover ring-4"
            style={{ ["--tw-ring-color" as any]: hexToRgba(accent, 0.85), backgroundColor: bgColor }}
          />
        </div>

        <h1
          className="font-display text-2xl sm:text-3xl font-bold tracking-tight uppercase mt-3 text-center animate-fade-up"
          style={{ animationDelay: "80ms" }}
        >
          {firstName} {restName && <span style={{ color: accent }}>{restName}</span>}
        </h1>

        {profile.bio && (
          <p
            className="text-sm mt-1 text-center max-w-xs animate-fade-up"
            style={{ opacity: 0.75, animationDelay: "140ms" }}
          >
            {profile.bio}
          </p>
        )}

        {profile.about_location && (
          <div
            className="flex items-center gap-1.5 mt-2 text-sm animate-fade-up"
            style={{ color: accent, animationDelay: "180ms" }}
          >
            <MapPin size={14} />
            {profile.about_location}
          </div>
        )}

        {profile.about_long_bio && (
          <p
            className="text-sm mt-3 text-center max-w-md leading-relaxed animate-fade-up"
            style={{ opacity: 0.85, animationDelay: "220ms" }}
          >
            {profile.about_long_bio}
          </p>
        )}

        {profile.whatsapp_number && (
          <div className="flex gap-3 mt-5 w-full max-w-sm animate-fade-up" style={{ animationDelay: "260ms" }}>
            <WhatsAppButton
              number={profile.whatsapp_number}
              message={profile.default_whatsapp_message}
              radiusClass={radiusClass}
              buttonStyle={linkButtonStyle}
              onClick={() => logClick("whatsapp")}
            />
            <div className="flex-1">
              <CallButton
                number={profile.whatsapp_number}
                radiusClass={radiusClass}
                buttonStyle={linkButtonStyle}
              />
            </div>
          </div>
        )}

        {profile.social_links?.length > 0 && (
          <div
            className="flex flex-wrap justify-center gap-2.5 mt-5 animate-fade-up"
            style={{ animationDelay: "300ms" }}
          >
            {profile.social_links.map((s: any) => (
              <SocialIcon key={s.id} platform={s.platform} url={s.url} themed />
            ))}
          </div>
        )}

        <div className="w-full max-w-md mt-6 flex flex-col gap-6 animate-fade-up" style={{ animationDelay: "340ms" }}>
          {(() => {
            const hasRoleCard = profile.about_position || profile.about_company;

            const extraPhoneRows = (profile.profile_phone_numbers || [])
              .filter((p: any) => p.phone_number?.trim())
              .sort((a: any, b: any) => a.sort_order - b.sort_order)
              .map((p: any) => ({
                icon: Phone,
                label: t.profilePage.phone,
                value: p.phone_number,
                href: `tel:${p.phone_number.replace(/[^0-9+]/g, "")}`,
              }));

            const contactRows = [
              profile.about_email && {
                icon: Mail,
                label: t.profilePage.email,
                value: profile.about_email,
                href: `mailto:${profile.about_email}`,
              },
              profile.about_phone && {
                icon: Phone,
                label: t.profilePage.phone,
                value: profile.about_phone,
                href: `tel:${profile.about_phone.replace(/[^0-9+]/g, "")}`,
              },
              ...extraPhoneRows,
              profile.about_location && {
                icon: MapPin,
                label: t.profilePage.location,
                value: profile.about_location,
              },
              profile.about_hours && {
                icon: Clock,
                label: t.profilePage.hours,
                value: profile.about_hours,
              },
            ].filter(Boolean) as { icon: any; label: string; value: string; href?: string }[];

            const isEmpty = !hasRoleCard && contactRows.length === 0;

            if (isEmpty) {
              return (
                <p className="text-sm text-center py-8" style={{ opacity: 0.5 }}>
                  {t.profilePage.noAboutInfo}
                </p>
              );
            }

            return (
              <div
                className={`relative overflow-hidden ${radiusClass}`}
                style={{ border: `1px solid ${borderTint}`, backgroundColor: hexToRgba(textColor, 0.03) }}
              >
                {/* Top accent stripe — the "card edge" a real business card has */}
                <div className="h-1.5 w-full" style={{ backgroundColor: accent }} />

                {/* A quiet nod to the ring motif used as the brand's own
                    signature elsewhere (the auth pages' pulsing rings) —
                    subtle enough not to compete with the actual content,
                    just enough to make this feel like a Ringo Connect
                    card rather than a generic one. */}
                <div
                  className="absolute -top-7 -right-7 w-32 h-32 rounded-full pointer-events-none"
                  style={{ border: `1.5px solid ${hexToRgba(accent, 0.2)}` }}
                />
                <div
                  className="absolute -top-2 -right-2 w-16 h-16 rounded-full pointer-events-none"
                  style={{ border: `1.5px solid ${hexToRgba(accent, 0.15)}` }}
                />

                <div className="relative p-5">
                  {hasRoleCard && (
                    <div className="mb-4">
                      {profile.about_position && (
                        <p className="text-base font-bold" style={{ color: accent }}>
                          {profile.about_position}
                        </p>
                      )}
                      {profile.about_company && (
                        <p className="text-sm mt-0.5" style={{ opacity: 0.7 }}>
                          {profile.about_company}
                        </p>
                      )}
                    </div>
                  )}

                  {hasRoleCard && contactRows.length > 0 && (
                    <div className="h-px w-full mb-4" style={{ backgroundColor: borderTint }} />
                  )}

                  {contactRows.length > 0 && (
                    <div className="grid sm:grid-cols-2 gap-x-5 gap-y-3.5">
                      {contactRows.map((item) => {
                        const inner = (
                          <>
                            <item.icon size={15} style={{ color: accent }} className="shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <p className="text-[10px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
                                {item.label}
                              </p>
                              <p className="text-sm font-medium truncate">{item.value}</p>
                            </div>
                          </>
                        );
                        return item.href ? (
                          <a
                            key={`${item.label}-${item.value}`}
                            href={item.href}
                            className="flex items-start gap-2.5 transition hover:opacity-75"
                          >
                            {inner}
                          </a>
                        ) : (
                          <div key={`${item.label}-${item.value}`} className="flex items-start gap-2.5">
                            {inner}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          {profile.links?.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-[11px] uppercase tracking-wider" style={{ opacity: 0.5 }}>
                {t.profilePage.linksHeading}
              </p>
              {profile.links
                .sort((a: any, b: any) => a.sort_order - b.sort_order)
                .map((link: any) => (
                  <a
                    key={link.id}
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => logClick("link", link.id)}
                    className={`flex items-center gap-3 p-3 transition hover:brightness-95 hover:-translate-y-0.5 active:scale-[0.98] active:brightness-90 ${radiusClass}`}
                    style={linkButtonStyle}
                  >
                    {link.image_url && (
                      <img src={link.image_url} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{link.title}</p>
                      {link.description && (
                        <p className="text-xs line-clamp-2 mt-0.5" style={{ opacity: 0.7 }}>
                          {link.description}
                        </p>
                      )}
                    </div>
                    <ChevronRight size={18} className="shrink-0" style={{ opacity: 0.6 }} />
                  </a>
                ))}
            </div>
          )}

          {profile.products?.length > 0 && (
            <div className="flex flex-col gap-3">
              <button
                onClick={() => setShowCatalog((v) => !v)}
                className={`flex items-center justify-between p-3.5 transition active:scale-[0.98] ${radiusClass}`}
                style={{
                  border: `1px solid ${borderTint}`,
                  backgroundColor: showCatalog ? hexToRgba(accent, 0.08) : "transparent",
                }}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  <ShoppingBag size={16} style={{ color: accent }} />
                  {t.profilePage.catalogHeading}
                  <span style={{ opacity: 0.5 }}>({profile.products.length})</span>
                </span>
                <ChevronDown
                  size={16}
                  className={`transition-transform ${showCatalog ? "rotate-180" : ""}`}
                  style={{ opacity: 0.6 }}
                />
              </button>

              <AnimatePresence initial={false}>
                {showCatalog && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="overflow-hidden"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      {profile.products
                        .sort((a: any, b: any) => a.sort_order - b.sort_order)
                        .map((product: any) => (
                          <div
                            key={product.id}
                            className={`overflow-hidden transition hover:-translate-y-0.5 ${radiusClass}`}
                            style={{ border: `1px solid ${borderTint}` }}
                          >
                            {product.image_url && (
                              <img
                                src={product.image_url}
                                alt={product.name}
                                className="w-full aspect-square object-cover"
                              />
                            )}
                            <div className="p-3">
                              <p className="text-sm font-semibold truncate">{product.name}</p>
                              {product.price && (
                                <p
                                  className="text-sm font-bold mt-0.5"
                                  style={{ color: accent }}
                                  suppressHydrationWarning
                                >
                                  {formatPrice(product.price, profile.currency)}
                                </p>
                              )}
                              {/* Full-width, stacked CTAs — the old side-by-side
                                  tiny icon buttons were cramped on a phone-width
                                  half-grid card; a real tap target beats a
                                  compact one here. */}
                              <div className="flex flex-col gap-1.5 mt-2.5">
                                {product.landing_url && (
                                  <a
                                    href={product.landing_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => logClick("product", product.id)}
                                    className={`flex items-center justify-center gap-1.5 text-xs font-medium py-2 transition hover:brightness-95 active:scale-[0.97] ${radiusClass}`}
                                    style={{ border: `1px solid ${borderTint}` }}
                                  >
                                    <ExternalLink size={12} />
                                    {t.profilePage.viewDetails}
                                  </a>
                                )}
                                <WhatsAppButton
                                  number={profile.whatsapp_number}
                                  message={product.whatsapp_message || `Hi, I'm interested in ${product.name}`}
                                  radiusClass={radiusClass}
                                  buttonStyle={linkButtonStyle}
                                  onClick={() => logClick("whatsapp", product.id)}
                                />
                              </div>
                            </div>
                          </div>
                        ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        <div className="mt-10 text-center">
          <p className="text-xs" style={{ opacity: 0.5 }}>
            © {new Date().getFullYear()} {profile.name}. All rights reserved.
          </p>
          <p className="text-xs mt-1" style={{ opacity: 0.4 }}>
            Made with Ringo Connect
          </p>
        </div>
      </div>
    </main>
  );
}