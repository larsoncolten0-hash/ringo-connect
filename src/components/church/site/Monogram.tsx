import { CH, SERIF, churchPalette } from "./churchTheme";

/** The church's initial on its accent, for a church with no picture yet (never a broken image). Decorative: the name is always written beside it. */
export default function Monogram({ name, accent, className = "", ringColor = CH.paper }: { name: string; accent: string; className?: string; ringColor?: string }) {
  const pal = churchPalette(accent);
  return (
    <span aria-hidden="true" className={`flex shrink-0 select-none items-center justify-center font-semibold ${className}`} style={{ backgroundColor: pal.accent, color: pal.onAccent, fontFamily: SERIF, ["--tw-ring-color" as any]: ringColor }}>
      {(name.trim()[0] || "").toUpperCase()}
    </span>
  );
}
