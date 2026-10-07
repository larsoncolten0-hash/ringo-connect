/** @type {import('next').NextConfig} */
const nextConfig = {
  // The built-in image optimizer (/_next/image) is switched OFF. next/image is only used here for the platform's own logos; every user-uploaded image is a plain
  // <img>. The optimizer was reachable by anyone, with a source URL of their choosing: the old `**.supabase.co` pattern matched ANY Supabase project, so an
  // attacker could host a crafted image (e.g. an AVIF, the Next.js image-optimizer RCE advisory GHSA-2xp9-vwfh-vxw4, or an oversized one for the optimizer DoS
  // advisories) on a free project of their own and have our server fetch and decode it. Unoptimized, /_next/image answers 404 and next/image renders the
  // original URL. Re-enable only together with the Next.js upgrade, and then with a pattern limited to this project's own host and path.
  images: {
    unoptimized: true,
  },
  experimental: {
    // Next 14's App Router client-side Router Cache keeps a dynamic page's already-rendered RSC
    // payload around for 30s by default, independent of `export const dynamic = "force-dynamic"`
    // (which only controls SERVER-side rendering/caching). Every save in this app writes straight
    // to Supabase from the browser (not a Server Action Next itself can hook into), so Next has no
    // way to know a client-side-cached page needs invalidating — the result was: save an edit
    // (a product, a ticket, anything), navigate away and back within that window, and the old data
    // would still show until a hard refresh. Setting this to 0 makes every dashboard/editor
    // navigation always re-fetch fresh data, everywhere, without touching any individual save
    // handler.
    staleTimes: { dynamic: 0 },
  },
  // Share links (/d/<token>) carry a secret in the URL: never cache, index, frame or leak it as a referrer. The page and route also
  // set the same themselves; this covers every response beneath /d/.
  async headers() {
    return [
      {
        source: "/d/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, max-age=0" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
