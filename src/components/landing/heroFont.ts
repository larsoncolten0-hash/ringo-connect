import { Bricolage_Grotesque } from "next/font/google";

// The landing hero's display face (Phase 2A pilot). Loaded here, in the landing module graph, and not in the root layout, so
// the font file is only requested on the page that uses it; every other route keeps loading exactly what it loaded before
// (Space Grotesk for display, Inter for body). Weights 600 and 700 only: 800 wrapped the long French headline to a fourth line.
export const heroDisplay = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-hero-display",
  weight: ["600", "700"],
  display: "swap",
});
