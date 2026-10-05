import Ring from "@/components/brand/Ring";

// The close of a public profile: one hairline, the Ringo ring (open, in the page's own accent) and a second hairline. After identity,
// the offer and the ways to reach the person, the page ends on the mark of connection rather than simply running out; the "Powered by
// Ringo" link beneath it is the Ringo identity itself. Purely a mark: it states nothing, so it carries no text, holds no data and is
// hidden from assistive technology. Server-renderable (no state, no motion).
export default function ConnectionSeal({ accent, line, className = "" }: { accent: string; line: string; className?: string }) {
  return (
    <div aria-hidden="true" className={`mx-auto flex w-full max-w-xs items-center gap-4 ${className}`}>
      <span className="h-px flex-1" style={{ backgroundColor: line }} />
      <Ring size={36} state="idle" weight="fine" color={accent} />
      <span className="h-px flex-1" style={{ backgroundColor: line }} />
    </div>
  );
}
