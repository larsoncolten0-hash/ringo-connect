"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import AuthShell from "@/components/auth/AuthShell";

export default function ConfirmedPage() {
  const router = useRouter();
  const [countdown, setCountdown] = useState(3);

  useEffect(() => {
    if (countdown === 0) {
      router.push("/dashboard");
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  return (
    <AuthShell
      eyebrow="You're in"
      title="Email confirmed"
      subtitle="Your account is active and your page is ready to build."
    >
      <div className="flex flex-col items-center text-center gap-4 py-4">
        <div className="w-12 h-12 rounded-full bg-ringo-teal/10 flex items-center justify-center">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="M5 13l4 4L19 7"
              stroke="#14B8A6"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <p className="text-sm text-ringo-muted">
          Taking you to your dashboard in {countdown}…
        </p>
        <button
          onClick={() => router.push("/dashboard")}
          className="text-sm text-ringo-indigo font-medium hover:underline"
        >
          Go now
        </button>
      </div>
    </AuthShell>
  );
}