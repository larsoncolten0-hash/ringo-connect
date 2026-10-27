import type { Metadata, ResolvingMetadata } from "next";
import { generateViewport } from "@/lib/profileMetadata";
import { ChurchLandingPage, landingMetadata } from "../_landing";

// The "testimonies" landing page of a church (see ../_landing.tsx).
export const dynamic = "force-dynamic";
export { generateViewport };

export async function generateMetadata({ params }: { params: { username: string } }, parent: ResolvingMetadata): Promise<Metadata> {
  return landingMetadata("testimonies", { params }, parent);
}

export default function Page({ params }: { params: { username: string } }) {
  return <ChurchLandingPage kind="testimonies" params={params} />;
}
