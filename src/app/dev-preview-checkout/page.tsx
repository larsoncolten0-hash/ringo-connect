import { notFound } from "next/navigation";
import CheckoutPreview from "@/components/checkout/CheckoutPreview";
import { PREVIEW_SCENARIOS, type PreviewScenario } from "@/components/checkout/previewScenarios";

// Visual QA only — renders the real checkout against a scripted mock backend. Not linked from anywhere,
// and it does not exist in production. Try /dev-preview-checkout?scenario=success (or waiting, failed,
// expired, order_expired, review, unavailable, pay_error).
export const dynamic = "force-dynamic";

export default function DevPreviewCheckout({ searchParams }: { searchParams: { scenario?: string; theme?: string; accent?: string } }) {
  if (process.env.NODE_ENV === "production") return notFound();
  const scenario = (PREVIEW_SCENARIOS as readonly string[]).includes(searchParams.scenario || "") ? (searchParams.scenario as PreviewScenario) : "form";
  // ?theme=light and ?accent=%23RRGGBB let a reviewer see other seller brandings (harness only).
  const light = searchParams.theme === "light";
  const accent = /^#[0-9a-f]{6}$/i.test(searchParams.accent || "") ? (searchParams.accent as string) : "#D4A954";
  return <CheckoutPreview scenario={scenario} theme={{ accent, bg: light ? "#FFFFFF" : "#0A0A0A", fg: light ? "#111111" : "#FAFAFA" }} />;
}
