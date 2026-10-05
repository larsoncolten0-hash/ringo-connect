import { notFound } from "next/navigation";
import ProfileView from "@/components/ProfileView";
import { buildPreviewProfile, PREVIEW_CATEGORY_IDS } from "./fixtures";

// Visual QA only: the real public profile (ProfileView) rendered for any category from in-memory fixtures. Not linked from anywhere, and
// it does not exist in production (same gate as /dev-preview-checkout and /dev-preview-foundation). It reads no data and calls no API.
// ?cat=<category id>  ?accent=%23RRGGBB  ?bg=%23RRGGBB  ?text=%23RRGGBB  ?bgStyle=solid|gradient  ?button=outline|fill|soft
// ?radius=rounded|square|pill  ?long=1 (a very long name)  ?minimal=1 (no cover, bio, links or contact)  ?preview=1 (editor variant)
// The language is the visitor's own (the locale in localStorage), exactly as on a real profile; ?lang= only picks the fixture's copy.
export const dynamic = "force-dynamic";

const hex = (v: string | undefined, fallback: string) => (/^#[0-9a-f]{6}$/i.test(v || "") ? (v as string) : fallback);

export default function DevPreviewProfile({ searchParams: q }: { searchParams: Record<string, string | undefined> }) {
  if (process.env.NODE_ENV === "production") return notFound();
  const category = PREVIEW_CATEGORY_IDS.includes(q.cat || "") ? (q.cat as string) : q.cat === "unknown" ? "not_a_category" : "other";
  const profile = buildPreviewProfile({
    category,
    lang: q.lang === "fr" ? "fr" : "en",
    accent: hex(q.accent, "#D4A954"),
    bg: hex(q.bg, "#0A0A0A"),
    text: hex(q.text, "#FAFAFA"),
    bgStyle: q.bgStyle === "gradient" ? "gradient" : "solid",
    button: ["outline", "fill", "soft"].includes(q.button || "") ? (q.button as string) : "outline",
    radius: ["rounded", "square", "pill"].includes(q.radius || "") ? (q.radius as string) : "rounded",
    long: q.long === "1",
    minimal: q.minimal === "1",
  });
  // The public composition (share, language selector, skip link) by default; ?preview=1 renders the dashboard editor's embedded variant.
  return <ProfileView profile={profile} pageViewEventId="preview" preview={q.preview === "1"} />;
}
