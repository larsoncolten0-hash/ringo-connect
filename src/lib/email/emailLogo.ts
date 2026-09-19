// The full Ringo Connect logo for email mastheads. Email clients need an
// absolute URL, so this points at the production site's copy of the
// email-sized (300px-wide, shown at 150px for sharpness on hi-dpi screens)
// PNG of the approved light-background logo — every Ringo email card is
// white, so the dark-wordmark version is the right one. `alt` keeps the
// name visible if a client blocks images.
export function emailLogoImg(style: string): string {
  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "");
  return `<img src="${siteUrl}/brand/ringo-logo-email.png" alt="Ringo Connect" width="150" style="display:block;height:auto;border:0;${style}" />`;
}
