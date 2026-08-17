"use client";

import { ExternalLink } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import ProfileHeaderCard from "@/components/editor/ProfileHeaderCard";
import ThemeCard from "@/components/editor/ThemeCard";
import WhatsAppCard from "@/components/editor/WhatsAppCard";
import SocialLinksCard from "@/components/editor/SocialLinksCard";
import LinksCard from "@/components/editor/LinksCard";
import CatalogCard from "@/components/editor/CatalogCard";
import AboutCard from "@/components/editor/AboutCard";
import PixelsCard from "@/components/editor/PixelsCard";

export default function Editor({
  profile,
  plan,
  userId,
}: {
  profile: any;
  plan: any;
  userId: string;
}) {
  const { t } = useLanguage();
  const catalogLocked = plan?.max_products === 0;

  return (
    <div className="max-w-2xl mx-auto flex flex-col gap-5">
      <a
        href={`/${profile.username}`}
        target="_blank"
        className="self-start flex items-center gap-1.5 text-sm font-medium text-ringo-indigo bg-ringo-indigo/10 hover:bg-ringo-indigo/15 transition rounded-full pl-3 pr-3.5 py-1.5"
      >
        {t.editor.viewLivePage.replace(" →", "")}
        <ExternalLink size={13} />
      </a>

      <ProfileHeaderCard
        profileId={profile.id}
        userId={userId}
        initialAvatarUrl={profile.avatar_url}
        initialCoverUrl={profile.cover_image_url}
        initialName={profile.name}
        initialBio={profile.bio}
      />

      <ThemeCard
        profileId={profile.id}
        themeEnabled={!!plan?.custom_theme_enabled}
        initial={{
          themeColor: profile.theme_color,
          backgroundStyle: profile.background_style,
          backgroundColor: profile.background_color,
          backgroundGradientEnd: profile.background_gradient_end,
          textColor: profile.text_color,
          buttonStyle: profile.button_style,
          buttonRadius: profile.button_radius,
        }}
      />

      <WhatsAppCard
        profileId={profile.id}
        initialNumber={profile.whatsapp_number}
        initialMessage={profile.default_whatsapp_message}
      />

      <SocialLinksCard profileId={profile.id} initialSocials={profile.social_links || []} />

      <LinksCard
        profileId={profile.id}
        userId={userId}
        initialLinks={profile.links || []}
        maxLinks={plan?.max_links ?? null}
      />

      <CatalogCard
        profileId={profile.id}
        userId={userId}
        initialProducts={profile.products || []}
        catalogLocked={catalogLocked}
        maxProducts={plan?.max_products ?? null}
        initialCurrency={profile.currency || "USD"}
      />

      <AboutCard
        profileId={profile.id}
        initialLongBio={profile.about_long_bio}
        initialEmail={profile.about_email}
        initialPhone={profile.about_phone}
        initialCompany={profile.about_company}
        initialPosition={profile.about_position}
        initialLocation={profile.about_location}
        initialHours={profile.about_hours}
        initialExtraPhones={profile.profile_phone_numbers || []}
      />

      <PixelsCard
        profileId={profile.id}
        pixelsEnabled={!!plan?.pixels_enabled}
        initialFacebookId={profile.facebook_pixel_id}
        initialTiktokId={profile.tiktok_pixel_id}
      />
    </div>
  );
}