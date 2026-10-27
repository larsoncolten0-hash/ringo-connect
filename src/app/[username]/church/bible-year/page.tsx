import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateViewport } from "@/lib/profileMetadata";
import { loadPublicFeatures } from "@/lib/church/public/features";
import ChurchExpansionPage from "@/components/church/site/ChurchExpansionPage";
import { churchOf, churchPageMetadata, loadChurchProfile } from "../_landing";

// "The Bible in one year" of a church (/{username}/church/bible-year). The page exists only for a published, non-suspended CHURCH whose owner switched the feature on (any other profile, or a church that
// has not, gets the same 404). The plan is the same for every church and shows references only; what the page knows about the reader comes from the reader's own session, in the browser.
export const dynamic = "force-dynamic";
export { generateViewport };

export async function generateMetadata({ params }: { params: { username: string } }, parent: ResolvingMetadata): Promise<Metadata> {
  return churchPageMetadata((u) => `/${encodeURIComponent(u)}/church/bible-year`, "The Bible in one year", { params }, parent);
}

export default async function Page({ params }: { params: { username: string } }) {
  const profile = await loadChurchProfile(params.username);
  if (!profile) return notFound();
  const features = await loadPublicFeatures(createClient(), profile.id);
  if (!features.bible_year) return notFound();
  return <ChurchExpansionPage church={churchOf(profile)} data={{ mode: "bibleYear", profile: { id: profile.id, name: profile.name || profile.username } }} />;
}
