import Image from "next/image";

// The site-wide Suspense fallback — covers any top-level navigation that
// doesn't have a more specific loading.tsx of its own (landing, auth,
// public profile pages, the event scanner). /dashboard/** overrides this
// with a content-shaped skeleton instead (see
// src/app/dashboard/loading.tsx) since it has an actual layout to
// approximate; everywhere else's shape varies too much for a skeleton to
// help, so this is a small branded loader instead — the same pulsing
// "ring" signal as the auth pages' brand panel (see AuthShell.tsx), just
// scaled down for a brief in-between-pages moment rather than a hero.
export default function RootLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-ringo-bg">
      <div className="relative w-16 h-16 flex items-center justify-center animate-fade-in" role="status" aria-busy="true">
        <span className="sr-only">Loading…</span>
        <span className="absolute inset-0 rounded-full border border-ringo-indigo animate-ring-pulse-1" />
        <span className="absolute inset-0 rounded-full border border-ringo-teal animate-ring-pulse-2" />
        <Image src="/logo.png" alt="" width={30} height={30} className="rounded-[9px] relative z-10" />
      </div>
    </div>
  );
}
