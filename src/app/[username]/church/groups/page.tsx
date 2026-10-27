import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateViewport } from "@/lib/profileMetadata";
import { loadPublicGroups } from "@/lib/church/public/groups";
import ChurchExpansionPage from "@/components/church/site/ChurchExpansionPage";
import { churchOf, churchPageMetadata, loadChurchProfile } from "../_landing";

// The groups index of a church (/{username}/church/groups): its published Men, Women, Youths and Children pages. Same visibility gates as the landing pages (a published, non-suspended CHURCH profile; any
// other profile gets the same 404), the visitor's own session, nothing written. The loader is fail-safe: an error gives an empty list, which the page shows as its empty state.
export const dynamic = "force-dynamic";
export { generateViewport };

export async function generateMetadata({ params }: { params: { username: string } }, parent: ResolvingMetadata): Promise<Metadata> {
  return churchPageMetadata((u) => `/${encodeURIComponent(u)}/church/groups`, "Groups", { params }, parent);
}

export default async function Page({ params }: { params: { username: string } }) {
  const profile = await loadChurchProfile(params.username);
  if (!profile) return notFound();
  const groups = await loadPublicGroups(createClient(), profile.id);
  return <ChurchExpansionPage church={churchOf(profile)} data={{ mode: "groups", groups }} />;
}
