"use client";

import { useState } from "react";
import { ExternalLink } from "lucide-react";
import { formatPrice } from "@/lib/currency";
import { hexToRgba } from "@/lib/color";
import { getButtonStyle, getRadiusClass, getBackgroundStyle } from "@/lib/theme";
import WhatsAppButton from "./WhatsAppButton";
import SocialIcon from "./SocialIcon";

type Tab = "links" | "catalog" | "about";

export default function ProfileView({ profile }: { profile: any }) {
  const [tab, setTab] = useState<Tab>("links");

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

  const accent = profile.theme_color || "#4F46E5";
  const textColor = profile.text_color || "#0F172A";
  const radiusClass = getRadiusClass(profile.button_radius || "rounded");
  const linkButtonStyle = getButtonStyle(profile.button_style || "fill", accent);
  const borderTint = hexToRgba(textColor, 0.12);

  // The public page is the creator's brand, not app chrome — it renders
  // with exactly the colors they chose, independent of the visitor's own
  // dark mode preference (unlike the dashboard, which does follow it).
  const pageStyle = {
    ...getBackgroundStyle(profile.background_style || "solid", profile.background_color || "#FAFAF8", profile.background_gradient_end),
    color: textColor,
    ["--theme" as any]: accent,
  };

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-10" style={pageStyle}>
      <img
        src={profile.avatar_url || "/default-avatar.png"}
        alt={profile.name}
        className="w-20 h-20 rounded-full object-cover mb-3 ring-2"
        style={{ ["--tw-ring-color" as any]: hexToRgba(accent, 0.35) }}
      />
      <h1 className="text-xl font-medium">{profile.name}</h1>
      {profile.bio && (
        <p className="text-sm mt-1 text-center max-w-xs" style={{ opacity: 0.65 }}>
          {profile.bio}
        </p>
      )}

      {profile.social_links?.length > 0 && (
        <div className="flex gap-3 mt-4">
          {profile.social_links.map((s: any) => (
            <SocialIcon key={s.id} platform={s.platform} url={s.url} themed />
          ))}
        </div>
      )}

      {profile.whatsapp_number && (
        <div className="mt-4">
          <WhatsAppButton
            number={profile.whatsapp_number}
            message={profile.default_whatsapp_message}
            radiusClass={radiusClass}
            onClick={() => logClick("whatsapp")}
          />
        </div>
      )}

      <div
        className="flex gap-1 mt-6 rounded-card p-1"
        style={{ backgroundColor: hexToRgba(textColor, 0.06) }}
      >
        {(["links", "catalog", "about"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-4 py-1.5 text-sm rounded-card capitalize font-medium transition"
            style={
              tab === t
                ? { backgroundColor: "rgba(255,255,255,0.7)", color: accent }
                : { opacity: 0.55 }
            }
          >
            {t}
          </button>
        ))}
      </div>

      <div className="w-full max-w-md mt-6 flex flex-col gap-3">
        {tab === "links" &&
          profile.links
            ?.sort((a: any, b: any) => a.sort_order - b.sort_order)
            .map((link: any) => (
              <a
                key={link.id}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => logClick("link", link.id)}
                className={`flex items-center gap-3 p-3 transition hover:brightness-95 ${radiusClass}`}
                style={linkButtonStyle}
              >
                {link.image_url && (
                  <img src={link.image_url} alt="" className="w-10 h-10 rounded object-cover" />
                )}
                <span className="text-sm font-medium">{link.title}</span>
              </a>
            ))}

        {tab === "catalog" &&
          (profile.products?.length ? (
            <div className="grid grid-cols-2 gap-3">
              {profile.products
                .sort((a: any, b: any) => a.sort_order - b.sort_order)
                .map((product: any) => (
                  <div
                    key={product.id}
                    className={`overflow-hidden ${radiusClass}`}
                    style={{ border: `1px solid ${borderTint}` }}
                  >
                    {product.image_url && (
                      <img src={product.image_url} alt={product.name} className="w-full h-28 object-cover" />
                    )}
                    <div className="p-2">
                      <p className="text-sm font-medium">{product.name}</p>
                      {product.price && (
                        <p className="text-xs" style={{ opacity: 0.65 }} suppressHydrationWarning>
                          {formatPrice(product.price, profile.currency)}
                        </p>
                      )}
                      <div className="flex gap-1.5 mt-2 items-center">
                        {product.landing_url && (
                          <a
                            href={product.landing_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={() => logClick("product", product.id)}
                            aria-label="View details"
                            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-card transition hover:brightness-95"
                            style={{ border: `1px solid ${borderTint}`, color: accent }}
                          >
                            <ExternalLink size={14} />
                          </a>
                        )}
                        <WhatsAppButton
                          number={profile.whatsapp_number}
                          message={product.whatsapp_message || `Hi, I'm interested in ${product.name}`}
                          compact
                          radiusClass={radiusClass}
                          onClick={() => logClick("whatsapp", product.id)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
            </div>
          ) : (
            <p className="text-sm text-center" style={{ opacity: 0.65 }}>
              No products yet.
            </p>
          ))}

        {tab === "about" && (
          <div className="text-sm space-y-2">
            {profile.about_long_bio && <p>{profile.about_long_bio}</p>}
            {(profile.about_position || profile.about_company) && (
              <p className="font-medium">
                {profile.about_position}
                {profile.about_position && profile.about_company ? " at " : ""}
                {profile.about_company}
              </p>
            )}
            {profile.about_email && <p style={{ opacity: 0.65 }}>Email: {profile.about_email}</p>}
            {profile.about_phone && <p style={{ opacity: 0.65 }}>Phone: {profile.about_phone}</p>}
            {profile.about_location && <p style={{ opacity: 0.65 }}>Location: {profile.about_location}</p>}
            {profile.about_hours && <p style={{ opacity: 0.65 }}>Hours: {profile.about_hours}</p>}
          </div>
        )}
      </div>

      <p className="text-xs mt-10" style={{ opacity: 0.4 }}>
        Made with Ringo Connect
      </p>
    </main>
  );
}