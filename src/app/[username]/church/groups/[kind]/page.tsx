import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateViewport } from "@/lib/profileMetadata";
import { loadPublicGroupPage } from "@/lib/church/public/groups";
import { isPublicGroupKind } from "@/lib/church/pubgroups/kinds";
import ChurchExpansionPage from "@/components/church/site/ChurchExpansionPage";
import { churchOf, churchPageMetadata, loadChurchProfile } from "../../_landing";

// One public group page of a church (/{username}/church/groups/men | women | youths | children). A group that is not published, or a kind that does not exist, is the same 404 as a church with no such
// page. The page lists no member; the Children page carries no caption. The visitor's own session is used, so the database's public policies decide which rows exist for them.
export const dynamic = "force-dynamic";
export { generateViewport };

type Props = { params: { username: string; kind: string } };

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  if (!isPublicGroupKind(params.kind)) return churchPageMetadata((u) => `/${encodeURIComponent(u)}/church/groups`, "Groups", { params }, parent);
  const label = { men: "Men", women: "Women", youths: "Youths", children: "Children" }[params.kind];
  return churchPageMetadata((u) => `/${encodeURIComponent(u)}/church/groups/${params.kind}`, label, { params }, parent);
}

export default async function Page({ params }: Props) {
  const profile = await loadChurchProfile(params.username);
  if (!profile || !isPublicGroupKind(params.kind)) return notFound();
  const page = await loadPublicGroupPage(createClient(), profile.id, params.kind);
  if (!page) return notFound();
  return <ChurchExpansionPage church={churchOf(profile)} data={{ mode: "group", page }} />;
}
