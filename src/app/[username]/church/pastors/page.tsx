import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateViewport } from "@/lib/profileMetadata";
import { loadPublicPastors } from "@/lib/church/public/groups";
import ChurchExpansionPage from "@/components/church/site/ChurchExpansionPage";
import { churchOf, churchPageMetadata, loadChurchProfile } from "../_landing";

// The Pastors page of a church (/{username}/church/pastors): its published pastors, then its vision and mission. Same visibility gates as the landing pages. The loaders are fail-safe: an error gives
// nothing, which the page shows as its empty state.
export const dynamic = "force-dynamic";
export { generateViewport };

export async function generateMetadata({ params }: { params: { username: string } }, parent: ResolvingMetadata): Promise<Metadata> {
  return churchPageMetadata((u) => `/${encodeURIComponent(u)}/church/pastors`, "Pastors", { params }, parent);
}

export default async function Page({ params }: { params: { username: string } }) {
  const profile = await loadChurchProfile(params.username);
  if (!profile) return notFound();
  const { pastors, about } = await loadPublicPastors(createClient(), profile.id);
  return <ChurchExpansionPage church={churchOf(profile)} data={{ mode: "pastors", pastors, about }} />;
}
