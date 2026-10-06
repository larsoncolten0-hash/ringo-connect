"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { PUSH_RESUME_KEY, resumePushIfRemembered } from "@/lib/push/subscribeClient";

// Mounted once in each signed-in shell. If THIS account turned push off by signing out on this device, it is turned back on now (silently: the browser
// permission is already granted). Renders nothing, and does nothing at all unless a resume was remembered, so a normal page load costs one storage read.
// See src/lib/push/subscribeClient.ts for why only the same account ever resumes.
export default function PushResume({ subscribeUrl }: { subscribeUrl: string }) {
  useEffect(() => {
    let remembered: string | null = null;
    try {
      remembered = localStorage.getItem(PUSH_RESUME_KEY);
    } catch {
      return;
    }
    if (!remembered) return;
    let cancelled = false;
    (async () => {
      const {
        data: { user },
      } = await createClient().auth.getUser();
      if (cancelled || !user) return;
      await resumePushIfRemembered(user.id, subscribeUrl);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [subscribeUrl]);
  return null;
}
