"use client";

import { useEffect } from "react";
import { captureReferralFromUrl } from "@/lib/referral";

/** Renders nothing — just fires the referral-capture side effect once,
 *  from the root layout, so ?ref=CODE is caught no matter which page
 *  someone's affiliate link points at (landing page, signup, get-started, a
 *  live /:username profile). */
export default function ReferralCapture() {
  useEffect(() => {
    captureReferralFromUrl();
  }, []);
  return null;
}
