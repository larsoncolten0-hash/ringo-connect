// A single, quiet gradient wash — used sparingly (the hero, the final
// CTA, a couple of key moments), not on every section. Static, not
// animated: a premium page uses color with restraint, it doesn't pulse it
// at you.
const TONES = {
  brand: ["#4F46E5", "#14B8A6"],
  gold: ["#F2B705", "#4F46E5"],
  green: ["#1F9D55", "#0EA5E9"],
} as const;

export default function GradientMesh({ tone = "brand", className = "" }: { tone?: keyof typeof TONES; className?: string }) {
  const [a, b] = TONES[tone];
  return (
    <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden="true">
      <div className="absolute -top-40 left-1/4 w-[560px] h-[420px] rounded-full blur-[130px] opacity-[0.14]" style={{ backgroundColor: a }} />
      <div className="absolute bottom-0 right-0 w-[420px] h-[320px] rounded-full blur-[120px] opacity-[0.1]" style={{ backgroundColor: b }} />
    </div>
  );
}
