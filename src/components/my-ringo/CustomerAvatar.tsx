/* eslint-disable @next/next/no-img-element */

export function customerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0][0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase();
}

// The customer's own avatar (ringo_customers.avatar_url) or a tasteful
// initials placeholder — no upload flow exists yet, so most customers will
// see initials. Also used for a connected profile's avatar (same shape).
export default function CustomerAvatar({
  name,
  avatarUrl,
  className = "w-10 h-10 text-sm",
}: {
  name: string;
  avatarUrl?: string | null;
  className?: string;
}) {
  if (avatarUrl) {
    return <img src={avatarUrl} alt="" className={`${className} rounded-full object-cover shrink-0 bg-ringo-muted/10`} />;
  }
  return (
    <span
      aria-hidden="true"
      className={`${className} rounded-full shrink-0 flex items-center justify-center font-semibold text-white bg-gradient-to-br from-ringo-indigo to-ringo-indigo/70`}
    >
      {customerInitials(name)}
    </span>
  );
}
