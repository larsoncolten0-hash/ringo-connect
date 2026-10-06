"use client";

import { useEffect } from "react";
import PublicProfileError from "../../[username]/error";

// The fallback for a failed render under this public storefront (its menu, items and ordering). The public profile segment already had this screen;
// this storefront is a separate top-level route, so until now a failure here showed Next's bare default error page with no way back. It reuses the
// profile's boundary (same quiet branded screen, the visitor's language, Try again / Go to Ringo, and no error text, digest or stack on screen), so no
// new wording is introduced and EN / FR already exist. There is deliberately no site-wide boundary (see premiumPolish.test.mjs): the dashboard keeps its
// own and the admin area keeps Next's default.
//
// The browser console gets the error object (for a server render failure that is only Next's digest, which matches the entry in the Vercel logs).
export default function StorefrontError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return <PublicProfileError error={error} reset={reset} />;
}
