import type { Metadata, ResolvingMetadata } from "next";
import { generateViewport } from "@/lib/profileMetadata";
import { ChurchLandingPage, landingMetadata } from "../_landing";

// The "events" landing page of a church (see ../_landing.tsx).
export const dynamic = "force-dynamic";
export { generateViewport };

export async function generateMetadata({ params }: { params: { username: string } }, parent: ResolvingMetadata): Promise<Metadata> {
  return landingMetadata("events", { params }, parent);
}

export default function Page({ params }: { params: { username: string } }) {
  return <ChurchLandingPage kind="events" params={params} />;
}
