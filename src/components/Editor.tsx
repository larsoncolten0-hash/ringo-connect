"use client";

import { ExternalLink } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import ProfileHeaderCard from "@/components/editor/ProfileHeaderCard";
import CategoryCard from "@/components/editor/CategoryCard";
import MusicSettingsCard from "@/components/editor/MusicSettingsCard";
import MusicReleasesCard from "@/components/editor/MusicReleasesCard";
import PinnedSpotlightCard from "@/components/editor/PinnedSpotlightCard";
import RestaurantSettingsCard from "@/components/editor/RestaurantSettingsCard";
import MenuCard from "@/components/editor/MenuCard";
import TablesCard from "@/components/editor/TablesCard";
import ThemeCard from "@/components/editor/ThemeCard";
import WhatsAppCard from "@/components/editor/WhatsAppCard";
import SocialLinksCard from "@/components/editor/SocialLinksCard";
import LinksCard from "@/components/editor/LinksCard";
import TracksCard from "@/components/editor/TracksCard";
import CatalogCard from "@/components/editor/CatalogCard";
import EventsCard from "@/components/editor/EventsCard";
import AboutCard from "@/components/editor/AboutCard";
import PixelsCard from "@/components/editor/PixelsCard";
import { EditorPreviewProvider, useEditorPreview } from "@/components/editor/EditorPreviewContext";
import LivePreviewPanel from "@/components/editor/LivePreviewPanel";
import { profileHasCategory } from "@/lib/categories";

export default function Editor({
  profile,
  plan,
  userId,
  siteUrl,
}: {
  profile: any;
  plan: any;
  userId: string;
  siteUrl: string;
}) {
  return (
    // initialProfile seeds the live preview with exactly what's already
    // saved — every card below pushes its own changes into this same
    // draft the moment they happen, so LivePreviewPanel always reflects
    // the current on-screen state, saved or not.
    <EditorPreviewProvider initialProfile={profile}>
      <EditorCards profile={profile} plan={plan} userId={userId} siteUrl={siteUrl} />
    </EditorPreviewProvider>
  );
}

// Split out from Editor so it can read the live draft (via
// useEditorPreview, which only works inside EditorPreviewProvider) instead
// of the static server-rendered `profile` prop — picking Music &
// Entertainment in CategoryCard needs the music-only cards below
// (MusicSettingsCard, TracksCard, EventsCard) to appear immediately, not
// only after a full page reload.
function EditorCards({
  profile,
  plan,
  userId,
  siteUrl,
}: {
  profile: any;
  plan: any;
  userId: string;
  siteUrl: string;
}) {
  const { t } = useLanguage();
  const { draft } = useEditorPreview();
  const catalogLocked = plan?.max_products === 0;
  const isMusic = profileHasCategory(draft, "music_entertainment");
  const isRestaurant = profileHasCategory(draft, "restaurant_food");

  return (
    <div className="max-w-6xl mx-auto lg:grid lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start lg:gap-8">
      <div className="max-w-2xl w-full mx-auto lg:mx-0 flex flex-col gap-5">
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

        <CategoryCard
          profileId={profile.id}
          initialCategory={profile.category}
          initialCategories={profile.categories}
        />

        {isMusic && (
          <MusicSettingsCard
            profileId={profile.id}
            initialRole={profile.music_role}
            initialSupportEnabled={profile.hub_support_enabled !== false}
            initialSupportMessage={profile.support_message}
          />
        )}

        {isRestaurant && (
          <RestaurantSettingsCard
            profileId={profile.id}
            initialSubcategory={profile.restaurant_subcategory}
            initialOrderingEnabled={profile.ordering_enabled !== false}
            initialDineIn={profile.dine_in_enabled !== false}
            initialTakeaway={profile.takeaway_enabled !== false}
            initialDelivery={!!profile.delivery_enabled}
            initialDeliveryFee={profile.delivery_fee}
            initialOpeningHours={profile.opening_hours}
          />
        )}

        {isRestaurant && (
          <MenuCard
            profileId={profile.id}
            userId={userId}
            initialCategories={profile.menu_categories || []}
            initialItems={profile.menu_items || []}
            currency={profile.currency || "USD"}
          />
        )}

        {isRestaurant && (
          <TablesCard
            profileId={profile.id}
            username={profile.username}
            siteUrl={siteUrl}
            initialTables={profile.restaurant_tables || []}
          />
        )}

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

        {isMusic && (
          <MusicReleasesCard profileId={profile.id} userId={userId} initialReleases={profile.music_releases || []} />
        )}

        {isMusic && (
          <TracksCard profileId={profile.id} userId={userId} initialTracks={profile.tracks || []} />
        )}

        <CatalogCard
          profileId={profile.id}
          userId={userId}
          initialProducts={profile.products || []}
          catalogLocked={catalogLocked}
          maxProducts={plan?.max_products ?? null}
          initialCurrency={profile.currency || "USD"}
        />

        {isMusic && (
          <EventsCard profileId={profile.id} userId={userId} initialEvents={profile.events || []} />
        )}

        {isMusic && (
          <PinnedSpotlightCard
            profileId={profile.id}
            initialPinnedType={profile.pinned_type}
            initialPinnedId={profile.pinned_id}
          />
        )}

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
          initialTestEventCode={profile.facebook_test_event_code}
          facebookCapiConfigured={!!profile.facebookCapiConfigured}
          tiktokEventsConfigured={!!profile.tiktokEventsConfigured}
        />
      </div>

      <LivePreviewPanel />
    </div>
  );
}
