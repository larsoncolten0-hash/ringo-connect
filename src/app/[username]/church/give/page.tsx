import type { Metadata, ResolvingMetadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { generateViewport } from "@/lib/profileMetadata";
import { loadPublicFeatures } from "@/lib/church/public/features";
import { loadOpenFunds } from "@/lib/church/public/giving";
import ChurchExpansionPage from "@/components/church/site/ChurchExpansionPage";
import { churchOf, churchPageMetadata, loadChurchProfile } from "../_landing";

// The giving page of a church (/{username}/church/give). It exists only for a published, non-suspended CHURCH whose owner switched giving on (anything else gets the same 404), and it lists only the funds that
// are published AND open. Which funds exist is read through the visitor's own (public) access; whether a gift can really be taken is decided again by the server and the database when the gift starts.
export const dynamic = "force-dynamic";
export { generateViewport };

export async function generateMetadata({ params }: { params: { username: string } }, parent: ResolvingMetadata): Promise<Metadata> {
  return churchPageMetadata((u) => `/${encodeURIComponent(u)}/church/give`, "Give", { params }, parent);
}

export default async function Page({ params }: { params: { username: string } }) {
  const profile = await loadChurchProfile(params.username);
  if (!profile) return notFound();
  const supabase = createClient();
  const features = await loadPublicFeatures(supabase, profile.id);
  if (!features.giving) return notFound();
  const funds = await loadOpenFunds(supabase, profile.id);
  return <ChurchExpansionPage church={churchOf(profile)} data={{ mode: "give", funds }} />;
}
