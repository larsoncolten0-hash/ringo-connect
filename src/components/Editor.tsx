"use client";

import { ExternalLink, User, Tag, Sparkles, UtensilsCrossed, BookOpen, QrCode, Palette, MessageCircle, Share2, Link2, Disc3, Music, ShoppingBag, Ticket, Pin, Info, Radar } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { Accordion, AccordionLinkItem } from "@/components/ui/Accordion";
import EditorSection from "@/components/dashboard/EditorSection";
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
import AboutCard from "@/components/editor/AboutCard";
import PixelsCard from "@/components/editor/PixelsCard";
import { EditorCardBareGroup } from "@/components/editor/EditorCard";
import { EditorPreviewProvider, useEditorPreview } from "@/components/editor/EditorPreviewContext";
import LivePreviewPanel from "@/components/editor/LivePreviewPanel";
import { getCategory, getMusicRole, profileHasCategory, profileHasTicketing } from "@/lib/categories";

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
// Entertainment in CategoryCard needs the music-only rows below to appear
// immediately, not only after a full page reload.
//
// Every existing card below gets its own individual dropdown — Profile,
// Category, Music & Entertainment, Brand color, WhatsApp, Social Links,
// Links, EPs & Albums, Latest Beats/Music, etc. — one card per dropdown,
// deliberately not regrouped, in the exact same order this editor already
// used. Only the sections relevant to this profile's category appear at
// all (no restaurant tables for a musician, no merch/tracks for a
// restaurant), matching the existing per-card `isMusic`/`isRestaurant`
// gates this replaces.
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
  const { t, locale } = useLanguage();
  const { draft } = useEditorPreview();
  const catalogLocked = plan?.max_products === 0;
  const isMusic = profileHasCategory(draft, "music_entertainment");
  const isRestaurant = profileHasCategory(draft, "restaurant_food");
  // Events/ticket management (events, ticket types, Gate Access, Check-in)
  // has its own dedicated dashboard section (/dashboard/tickets) rather
  // than fields to fill in here — kept as a dropdown-styled row that
  // navigates there instead of expanding.
  const hasTicketing = profileHasTicketing(draft);
  // Same fallback wording each card already falls back to itself —
  // matching them exactly so a dropdown's title is never different from
  // what the card underneath it already used to show on its own.
  const catalogLabel = getCategory(draft.category)?.defaults.catalogLabel?.[locale] || t.editor.catalog;
  const tracksTitle = getMusicRole(draft.music_role)?.sectionLabel[locale] || t.music.tracksTitleFallback;

  // Every dropdown starts collapsed — click one, fill it in, Save Changes
  // closes it automatically, then open the next one.
  const searchParams = useSearchParams();
  const initialSection = searchParams.get("section");

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

        <Accordion defaultOpenId={initialSection} className="rounded-[20px] border border-ringo-border/60 bg-ringo-surface px-4 sm:px-5">
          <EditorSection id="profile" icon={User} title={t.editor.profile.title}>
            <EditorCardBareGroup>
              <ProfileHeaderCard
                profileId={profile.id}
                userId={userId}
                initialAvatarUrl={profile.avatar_url}
                initialCoverUrl={profile.cover_image_url}
                initialName={profile.name}
                initialBio={profile.bio}
              />
            </EditorCardBareGroup>
          </EditorSection>

          <EditorSection id="category" icon={Tag} title={t.editor.category.title}>
            <EditorCardBareGroup>
              <CategoryCard profileId={profile.id} initialCategory={profile.category} initialCategories={profile.categories} />
            </EditorCardBareGroup>
          </EditorSection>

          {isMusic && (
            <EditorSection id="music-settings" icon={Sparkles} title={t.music.settingsTitle}>
              <EditorCardBareGroup>
                <MusicSettingsCard
                  profileId={profile.id}
                  initialRole={profile.music_role}
                  initialSupportEnabled={profile.hub_support_enabled !== false}
                  initialSupportMessage={profile.support_message}
                />
              </EditorCardBareGroup>
            </EditorSection>
          )}

          {isRestaurant && (
            <EditorSection id="restaurant-settings" icon={UtensilsCrossed} title={t.restaurant.settingsTitle}>
              <EditorCardBareGroup>
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
              </EditorCardBareGroup>
            </EditorSection>
          )}

          {isRestaurant && (
            <EditorSection id="menu" icon={BookOpen} title={t.restaurant.menuTitle}>
              <EditorCardBareGroup>
                <MenuCard
                  profileId={profile.id}
                  userId={userId}
                  initialCategories={profile.menu_categories || []}
                  initialItems={profile.menu_items || []}
                  currency={profile.currency || "USD"}
                />
              </EditorCardBareGroup>
            </EditorSection>
          )}

          {isRestaurant && (
            <EditorSection id="tables" icon={QrCode} title={t.restaurant.tablesTitle}>
              <EditorCardBareGroup>
                <TablesCard profileId={profile.id} username={profile.username} siteUrl={siteUrl} initialTables={profile.restaurant_tables || []} />
              </EditorCardBareGroup>
            </EditorSection>
          )}

          <EditorSection id="theme" icon={Palette} title={t.editor.theme.title}>
            <EditorCardBareGroup>
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
            </EditorCardBareGroup>
          </EditorSection>

          <EditorSection id="whatsapp" icon={MessageCircle} title={t.editor.whatsapp}>
            <EditorCardBareGroup>
              <WhatsAppCard profileId={profile.id} initialNumber={profile.whatsapp_number} initialMessage={profile.default_whatsapp_message} />
            </EditorCardBareGroup>
          </EditorSection>

          <EditorSection id="social-links" icon={Share2} title={t.editor.socialLinks}>
            <EditorCardBareGroup>
              <SocialLinksCard profileId={profile.id} initialSocials={profile.social_links || []} />
            </EditorCardBareGroup>
          </EditorSection>

          <EditorSection id="links" icon={Link2} title={t.editor.links}>
            <EditorCardBareGroup>
              <LinksCard profileId={profile.id} userId={userId} initialLinks={profile.links || []} maxLinks={plan?.max_links ?? null} />
            </EditorCardBareGroup>
          </EditorSection>

          {isMusic && (
            <EditorSection id="releases" icon={Disc3} title={t.music.releasesTitle}>
              <EditorCardBareGroup>
                <MusicReleasesCard profileId={profile.id} userId={userId} initialReleases={profile.music_releases || []} />
              </EditorCardBareGroup>
            </EditorSection>
          )}

          {isMusic && (
            <EditorSection id="tracks" icon={Music} title={tracksTitle}>
              <EditorCardBareGroup>
                <TracksCard profileId={profile.id} userId={userId} initialTracks={profile.tracks || []} />
              </EditorCardBareGroup>
            </EditorSection>
          )}

          <EditorSection id="catalog" icon={ShoppingBag} title={catalogLabel}>
            <EditorCardBareGroup>
              <CatalogCard
                profileId={profile.id}
                userId={userId}
                initialProducts={profile.products || []}
                catalogLocked={catalogLocked}
                maxProducts={plan?.max_products ?? null}
                initialCurrency={profile.currency || "USD"}
                communityEnabled={!!profile.community_enabled}
              />
            </EditorCardBareGroup>
          </EditorSection>

          {hasTicketing && (
            <AccordionLinkItem icon={Ticket} title={t.music.ticketsEditorPointerTitle} subtitle={t.music.ticketsEditorPointerHint} href="/dashboard/tickets" />
          )}

          {isMusic && (
            <EditorSection id="pinned" icon={Pin} title={t.music.pinnedTitle}>
              <EditorCardBareGroup>
                <PinnedSpotlightCard profileId={profile.id} initialPinnedType={profile.pinned_type} initialPinnedId={profile.pinned_id} />
              </EditorCardBareGroup>
            </EditorSection>
          )}

          <EditorSection id="about" icon={Info} title={t.editor.about.title}>
            <EditorCardBareGroup>
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
            </EditorCardBareGroup>
          </EditorSection>

          <EditorSection id="pixels" icon={Radar} title={t.editor.trackingPixels}>
            <EditorCardBareGroup>
              <PixelsCard
                profileId={profile.id}
                pixelsEnabled={!!plan?.pixels_enabled}
                initialFacebookId={profile.facebook_pixel_id}
                initialTiktokId={profile.tiktok_pixel_id}
                initialTestEventCode={profile.facebook_test_event_code}
                facebookCapiConfigured={!!profile.facebookCapiConfigured}
                tiktokEventsConfigured={!!profile.tiktokEventsConfigured}
              />
            </EditorCardBareGroup>
          </EditorSection>
        </Accordion>
      </div>

      <LivePreviewPanel />
    </div>
  );
}
