/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.supabase.co" },
    ],
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
