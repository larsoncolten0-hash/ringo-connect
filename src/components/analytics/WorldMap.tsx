"use client";

import { useMemo, useState } from "react";
import { ComposableMap, Geographies, Geography } from "react-simple-maps";
import { Globe2, Eye, MousePointerClick } from "lucide-react";
import { useIsDark } from "@/lib/useIsDark";
import { numericToAlpha2 } from "@/lib/countryCodes";

const MAP_GEOGRAPHY = "/maps/world-50m.json";

// Sequential ramp on the brand's own indigo (#4F46E5 = Tailwind indigo-600)
// — one hue, monotone lightness, per the sequential-color rule (magnitude,
// not identity, so no need for a multi-hue categorical palette here).
// Index 0 is reserved for "no data"; dark mode flips the lightness anchor
// (bright = high) so the top of the ramp still pops against a dark
// surface instead of nearly disappearing into it.
const RAMP_LIGHT = ["#E7E9F3", "#E0E7FF", "#C7D2FE", "#A5B4FC", "#818CF8", "#6366F1", "#4338CA", "#312E81"];
const RAMP_DARK = ["#1E2A3F", "#312E81", "#3730A3", "#4338CA", "#4F46E5", "#6366F1", "#A5B4FC", "#E0E7FF"];

export type CountryMetricCounts = { page: number; link: number };

const METRICS = [
  { key: "page" as const, icon: Eye },
  { key: "link" as const, icon: MousePointerClick },
];

export default function WorldMap({
  countsByCountry,
  regionNames,
  labels,
  emptyLabel,
}: {
  countsByCountry: Record<string, CountryMetricCounts>;
  regionNames: Record<string, string>;
  labels: { pageViews: string; linkClicks: string };
  emptyLabel: string;
}) {
  const isDark = useIsDark();
  const [metric, setMetric] = useState<"page" | "link">("page");
  const [hovered, setHovered] = useState<{ name: string; count: number; x: number; y: number } | null>(null);

  const ramp = isDark ? RAMP_DARK : RAMP_LIGHT;

  const max = useMemo(
    () => Object.values(countsByCountry).reduce((m, c) => Math.max(m, c[metric]), 0),
    [countsByCountry, metric]
  );
  const hasData = max > 0;

  // Square-root scale rather than linear: click distributions across
  // countries are typically extremely long-tailed (one home country with
  // thousands of hits, everywhere else with a handful) — a linear scale
  // would paint nearly every country the same "no data" shade.
  const colorFor = (count: number) => {
    if (!count) return ramp[0];
    const steps = ramp.length - 1;
    const t = Math.sqrt(count / max);
    const idx = Math.min(steps, Math.max(1, Math.round(t * steps)));
    return ramp[idx];
  };

  const metricLabel = metric === "page" ? labels.pageViews : labels.linkClicks;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="inline-flex items-center gap-1 bg-ringo-muted/10 rounded-full p-1">
          {METRICS.map(({ key, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setMetric(key)}
              className={`inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition ${
                metric === key
                  ? "bg-ringo-surface text-ringo-text shadow-sm border border-ringo-border"
                  : "text-ringo-muted"
              }`}
            >
              <Icon size={12} />
              {key === "page" ? labels.pageViews : labels.linkClicks}
            </button>
          ))}
        </div>

        {hasData && (
          <div className="hidden sm:flex items-center gap-1.5">
            <span className="text-[10px] text-ringo-muted tabular-nums">0</span>
            {ramp.map((c) => (
              <span key={c} className="w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: c }} />
            ))}
            <span className="text-[10px] text-ringo-muted tabular-nums">{max.toLocaleString("en-US")}</span>
          </div>
        )}
      </div>

      {!hasData ? (
        <div className="flex flex-col items-center text-center gap-2 py-16">
          <span className="w-9 h-9 rounded-full bg-ringo-muted/10 flex items-center justify-center">
            <Globe2 size={15} className="text-ringo-muted" />
          </span>
          <p className="text-sm text-ringo-muted max-w-[220px]">{emptyLabel}</p>
        </div>
      ) : (
        <div className="relative" onMouseLeave={() => setHovered(null)}>
          <ComposableMap
            projectionConfig={{ scale: 148, center: [10, 10] }}
            style={{ width: "100%", height: "auto" }}
          >
            <Geographies geography={MAP_GEOGRAPHY}>
              {({ geographies }) =>
                geographies.map((geo) => {
                  const alpha2 = numericToAlpha2(geo.id);
                  const count = (alpha2 && countsByCountry[alpha2]?.[metric]) || 0;
                  const name = (alpha2 && regionNames[alpha2]) || geo.properties.name;

                  const showTooltip = (evt: React.MouseEvent) =>
                    setHovered({ name, count, x: evt.clientX, y: evt.clientY });

                  return (
                    <Geography
                      key={geo.rsmKey}
                      geography={geo}
                      fill={colorFor(count)}
                      stroke={isDark ? "#0B1120" : "#FAFAF8"}
                      strokeWidth={0.6}
                      onMouseEnter={showTooltip}
                      onMouseMove={showTooltip}
                      onClick={showTooltip}
                      style={{
                        default: { outline: "none" },
                        hover: { outline: "none", filter: "brightness(1.1)", cursor: "pointer" },
                        pressed: { outline: "none" },
                      }}
                    />
                  );
                })
              }
            </Geographies>
          </ComposableMap>

          {hovered && (
            <div
              className="fixed z-50 pointer-events-none rounded-card border border-ringo-border bg-ringo-surface px-3 py-2 text-xs shadow-lg"
              style={{ left: hovered.x + 14, top: hovered.y + 14 }}
            >
              <p className="font-medium text-ringo-text">{hovered.name}</p>
              <p className="text-ringo-muted tabular-nums">
                {hovered.count.toLocaleString("en-US")} {metricLabel.toLowerCase()}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
