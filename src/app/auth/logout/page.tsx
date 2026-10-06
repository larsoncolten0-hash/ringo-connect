"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import AuthShell from "@/components/auth/AuthShell";
import { getPushStatus, rememberPushResume, unsubscribeFromPush } from "@/lib/push/subscribeClient";

export default function LogoutPage() {
  const [done, setDone] = useState(false);
  const supabase = createClient();

  useEffect(() => {
    (async () => {
      // Take this device's push subscription off the account BEFORE the session ends (it is matched by endpoint, so no sign-in is needed, but the user id is
      // read first so the same account can quietly turn push back on when it signs in again). Never blocks signing out: any failure just moves on.
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        const status = await getPushStatus();
        if (user && status.supported && status.subscribed) {
          const result = await unsubscribeFromPush("/api/push/unsubscribe");
          if (result.ok) rememberPushResume(user.id);
        }
      } catch {
        // signing out must always work
      }
      await supabase.auth.signOut();
      setDone(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AuthShell
      eyebrow="See you soon"
      title={done ? "You're logged out" : "Logging out…"}
      subtitle="Your session has been ended on this device."
    >
      {done && (
        <div className="flex flex-col items-center text-center gap-4 py-2">
          <div className="w-12 h-12 rounded-full bg-ringo-muted/10 flex items-center justify-center">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4M10 17l5-5-5-5M15 12H3"
                stroke="var(--ringo-muted)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <Link
            href="/auth/login"
            className="text-sm text-ringo-indigo font-medium hover:underline"
          >
            Log back in
          </Link>
        </div>
      )}
    </AuthShell>
  );
}