import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { memoPerRequest } from "@/lib/requestMemo";
import { isPublicProfileSuspended } from "@/lib/publicProfileVisibility";
import { profileHasCategory } from "@/lib/categories";
import { generateMetadata as generateProfileMetadata } from "@/lib/profileMetadata";
import { NOINDEX, withItemSeo } from "@/lib/seo";
import { CHURCH_CATEGORY } from "@/lib/church/publicPage";
import { loadChurchLanding, landingPath, type ChurchLandingKind } from "@/lib/church/public/landing";
import { safeAccent } from "@/components/church/site/churchTheme";
import ChurchLandingView from "@/components/church/site/ChurchLandingView";

// The landing pages of a church's public site (/{username}/church/announcements | events | testimonies | care | bible): the full list behind each "See more" button. Same visibility gates as the profile
// and the Shop page: only a published, non-suspended profile that is a CHURCH (any other profile gets the same 404, so this route says nothing about them), the visitor's own session (the database's
// public policies decide which rows exist), nothing written. Everything loaded is fail-safe: an error gives an empty list, which the page shows as its empty state.

const TITLES: Record<ChurchLandingKind, string> = { announcements: "Announcements", events: "Upcoming events", testimonies: "Testimonies this week", care: "Care and support", bible: "Bible programmes" };

const load = memoPerRequest(async function load(username: string) {
  const supabase = createClient();
  const [{ data: profile }, suspended] = await Promise.all([
    supabase.from("profiles").select("id, username, name, bio, avatar_url, theme_color, category, categories").eq("username", username).eq("published", true).single(),
    isPublicProfileSuspended(username),
  ]);
  if (!profile || suspended || !profileHasCategory(profile, CHURCH_CATEGORY)) return null;
  return profile;
});

export async function landingMetadata(kind: ChurchLandingKind, { params }: { params: { username: string } }, parent: ResolvingMetadata): Promise<Metadata> {
  const profile = await load(params.username);
  // a page that would 404 advertises nothing of its own
  if (!profile) return { robots: NOINDEX };
  const base = await generateProfileMetadata({ params }, parent);
  return withItemSeo(base, { path: landingPath(params.username, kind), title: `${TITLES[kind]} — ${profile.name || profile.username}`, description: profile.bio, image: profile.avatar_url });
}

export async function ChurchLandingPage({ kind, params }: { kind: ChurchLandingKind; params: { username: string } }) {
  const profile = await load(params.username);
  if (!profile) return notFound();
  const data = await loadChurchLanding(createClient(), profile.id, kind);
  return <ChurchLandingView kind={kind} church={{ name: profile.name || profile.username, username: profile.username, avatarUrl: profile.avatar_url ?? null, accent: safeAccent(profile.theme_color) }} data={data} />;
}
