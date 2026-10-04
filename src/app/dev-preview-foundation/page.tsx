import { notFound } from "next/navigation";
import FoundationPreview from "@/components/brand/FoundationPreview";

// Visual QA only: the design foundation (tokens, glass, gilt, lamplight, the Ring, micro-labels, the Ringo Card) on the
// light and the dark stage. Not linked from anywhere, and it does not exist in production (same gate as
// /dev-preview-checkout). It reads no data and calls no API.
export const dynamic = "force-dynamic";

export default function DevPreviewFoundation() {
  if (process.env.NODE_ENV === "production") return notFound();
  return <FoundationPreview />;
}
