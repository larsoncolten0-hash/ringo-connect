import type { ReactNode } from "react";
import Image from "next/image";
import { DEFAULT_BRANDING, hasCustomLogo } from "@/lib/brandingDefaults";

// The one place the official Ringo Connect logo is rendered. Every asset it
// points at is extracted unchanged from the approved logo (public/brand/):
//   - ringo-logo-light.png  full logo, dark wordmark  (light backgrounds)
//   - ringo-logo-dark.png   full logo, near-white wordmark (dark backgrounds)
//   - ringo-symbol.png      the R symbol alone
// The R itself is identical in all three; only the wordmark color differs.
//
// Variants:
//   full        R + wordmark, always
//   symbol      R only (compact navigation, narrow spaces)
//   responsive  R only below the `sm` breakpoint, full logo from `sm` up
//
// Light/dark follows the app's existing theme (Tailwind `dark:` class
// strategy — see ThemeToggle / the themeInitScript in the root layout), so
// both files are rendered and CSS shows the right one; no new theme logic.
// `tone` pins a variant for surfaces whose background never changes with the
// theme (e.g. the admin console's and auth panel's fixed dark chrome).
//
// If an admin has uploaded their own logo via /admin/branding (logoUrl is
// no longer the bundled default), that upload still overrides the bundled
// logo exactly as before: each call site passes the markup it always
// rendered for a custom logo as `legacy`, and it is returned untouched.

// Pixel aspect ratio (width / height) of the full-logo PNGs.
const FULL_ASPECT = 1908 / 356;

const LIGHT_SRC = "/brand/ringo-logo-light.png";
const DARK_SRC = "/brand/ringo-logo-dark.png";
const SYMBOL_SRC = "/brand/ringo-symbol.png";

export default function BrandLogo({
  logoUrl,
  appName = DEFAULT_BRANDING.appName,
  variant = "responsive",
  height = 28,
  tone = "auto",
  className = "",
  legacy,
}: {
  logoUrl?: string;
  appName?: string;
  variant?: "full" | "symbol" | "responsive";
  // Rendered height in px. The full logo's width follows its aspect ratio;
  // the symbol is square, so this is also its width.
  height?: number;
  tone?: "auto" | "light" | "dark";
  className?: string;
  // The call site's original markup for an admin-uploaded logo (returned as-is).
  legacy?: ReactNode;
}) {
  const fullWidth = Math.round(height * FULL_ASPECT);

  if (logoUrl && hasCustomLogo(logoUrl)) {
    if (legacy) return <>{legacy}</>;
    const iconOnly = variant === "symbol";
    return (
      <span className={`inline-flex items-center gap-2 ${className}`}>
        <Image src={logoUrl} alt={iconOnly ? appName : ""} width={height} height={height} className="rounded-md object-contain" />
        {!iconOnly && (
          <span className={`font-display font-medium ${variant === "responsive" ? "hidden sm:inline" : ""}`}>{appName}</span>
        )}
      </span>
    );
  }

  const symbolClass = variant === "responsive" ? "sm:hidden" : "";
  const symbol = (
    <Image src={SYMBOL_SRC} alt={appName} width={height} height={height} className={`shrink-0 ${symbolClass}`} style={{ width: height, height }} />
  );
  if (variant === "symbol") return <span className={`inline-flex ${className}`}>{symbol}</span>;

  // `full` shows at every width; `responsive` only from `sm` up.
  const show = variant === "responsive" ? "sm:block" : "block";
  const hide = variant === "responsive" ? "hidden" : "";
  const size = { width: fullWidth, height };

  const lightImg = (
    <Image
      src={LIGHT_SRC}
      alt={appName}
      width={fullWidth}
      height={height}
      style={size}
      className={`shrink-0 ${hide} ${show} ${tone === "auto" ? (variant === "responsive" ? "dark:sm:hidden" : "dark:hidden") : ""}`}
    />
  );
  const darkImg = (
    <Image
      src={DARK_SRC}
      alt={appName}
      width={fullWidth}
      height={height}
      style={size}
      className={`shrink-0 ${tone === "auto" ? `hidden ${variant === "responsive" ? "dark:sm:block" : "dark:block"}` : `${hide} ${show}`}`}
    />
  );

  return (
    <span className={`inline-flex items-center ${className}`}>
      {variant === "responsive" && symbol}
      {tone !== "dark" && lightImg}
      {tone !== "light" && darkImg}
    </span>
  );
}
