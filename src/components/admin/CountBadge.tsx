// A small "needs your attention" pill — used across AdminShell's nav
// (desktop sidebar rows, the mobile hamburger's rows, and the mobile
// bottom tab bar's icons) wherever a count from src/lib/adminNavCounts.ts
// is > 0. Renders nothing at 0/undefined, so a caller can pass a count
// unconditionally without an extra `{count > 0 && ...}` at every call
// site. `variant="corner"` absolutely-positions itself over an icon's
// top-right corner (the caller must be `position: relative`) for the
// bottom tab bar's tight icon-over-label layout; the default "inline"
// variant sits as a plain trailing pill next to a label.
export default function CountBadge({ count, variant = "inline" }: { count?: number; variant?: "inline" | "corner" }) {
  if (!count || count <= 0) return null;
  const label = count > 99 ? "99+" : String(count);

  if (variant === "corner") {
    return (
      <span className="absolute -top-1 -right-2 min-w-[16px] h-[16px] px-1 rounded-full bg-ringo-coral text-white text-[9px] font-semibold flex items-center justify-center leading-none ring-2 ring-[#0B1023]">
        {label}
      </span>
    );
  }

  return (
    <span className="ml-auto shrink-0 min-w-[18px] h-[18px] px-1.5 rounded-full bg-ringo-coral text-white text-[10px] font-semibold flex items-center justify-center leading-none">
      {label}
    </span>
  );
}
