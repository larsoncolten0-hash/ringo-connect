"use client";

import { useEffect } from "react";
import { captureAmbassadorCodeFromUrl } from "@/lib/ambassadorReferral";

/** Renders nothing — just fires the Ambassador-code capture side effect
 *  once, from the root layout, so ?amb=CODE is caught no matter which
 *  page a Brand Ambassador's sales link points at. Wholly independent of
 *  ReferralCapture/?ref= — see src/lib/ambassadorReferral.ts. */
export default function AmbassadorCodeCapture() {
  useEffect(() => {
    captureAmbassadorCodeFromUrl();
  }, []);
  return null;
}
