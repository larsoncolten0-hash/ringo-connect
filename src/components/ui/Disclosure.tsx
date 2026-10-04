"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";

// A plain "show more" group for optional or advanced settings. It is the browser's own <details>, so it is
// keyboard-operable (Enter / Space on the heading), announces expanded/collapsed to screen readers, and
// needs no animation. The content stays in the page while collapsed, so anything inside it is still
// read by the section's Save. `defaultOpen` is used ONCE, when the group first appears: open it when it
// already holds something the user entered, so saved details are never hidden from them. It is never
// re-applied afterwards, so clearing the last filled field while editing does not collapse the group
// under the user's hands.
export default function Disclosure({
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [initiallyOpen] = useState(defaultOpen);
  return (
    <details open={initiallyOpen} className="group rounded-card border border-ringo-border bg-ringo-bg">
      <summary className="flex items-center justify-between gap-3 min-h-[44px] px-3 py-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ringo-text">{title}</span>
          {hint && <span className="block text-xs text-ringo-muted mt-0.5">{hint}</span>}
        </span>
        <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-ringo-muted transition-transform motion-reduce:transition-none group-open:rotate-180" />
      </summary>
      <div className="px-3 pb-3 pt-1 flex flex-col gap-2">{children}</div>
    </details>
  );
}
