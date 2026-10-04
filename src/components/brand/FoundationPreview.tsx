"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { CONNECT_STATES, nextConnectState, type ConnectState } from "@/lib/design/tapToConnect";
import MicroLabel from "./MicroLabel";
import Ring from "./Ring";
import RingoCard3D from "./RingoCard3D";

// Reviewer-facing sheet for /dev-preview-foundation. English headings on purpose: it is a QA page, never shown to a customer.
const SWATCHES: [string, string][] = [
  ["ink", "bg-ringo-ink"],
  ["ink-2", "bg-ringo-ink-2"],
  ["paper", "bg-ringo-paper border border-ringo-line-warm"],
  ["gold", "bg-ringo-gold"],
  ["gold-dark", "bg-ringo-gold-dark"],
  ["gold-light", "bg-ringo-gold-light"],
  ["ember", "bg-ringo-ember"],
  ["signal", "bg-ringo-signal"],
  ["rose", "bg-ringo-rose"],
  ["stone-300", "bg-ringo-stone-300"],
  ["stone-600", "bg-ringo-stone-600"],
];

export default function FoundationPreview() {
  const { t } = useLanguage();
  const [state, setState] = useState<ConnectState>("idle");

  return (
    <main className="min-h-screen bg-ringo-bg text-ringo-text">
      <section className="mx-auto max-w-5xl space-y-12 px-4 py-12 sm:px-6">
        <h1 className="font-display text-3xl font-bold">Ringo design foundation</h1>

        <div className="space-y-4">
          <h2 className="font-display text-xl font-semibold">Color</h2>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {SWATCHES.map(([name, cls]) => (
              <li key={name} className="space-y-1">
                <div className={`h-14 rounded-ringo-sm ${cls}`} />
                <p className="ringo-micro text-ringo-muted">{name}</p>
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="text-ringo-gold-text">gold text</span>
            <span className="text-ringo-signal-text">signal text</span>
            <span className="text-ringo-ember-text">ember text</span>
            <span className="text-ringo-rose-text">rose text</span>
            <span className="rounded-full bg-ringo-accent px-3 py-1 text-ringo-on-accent">accent (indigo today)</span>
          </p>
        </div>

        <div className="space-y-4">
          <h2 className="font-display text-xl font-semibold">Radius, elevation, borders</h2>
          <div className="flex flex-wrap gap-4">
            {(
              [
                ["ringo-sm", "rounded-ringo-sm"],
                ["ringo-md", "rounded-ringo-md"],
                ["ringo-lg", "rounded-ringo-lg"],
                ["ringo-xl", "rounded-ringo-xl"],
                ["pill", "rounded-full"],
              ] as const
            ).map(([name, cls]) => (
              <div key={name} className={`flex h-20 w-28 items-center justify-center bg-ringo-surface text-xs shadow-ringo-1 ${cls}`}>
                {name}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-4">
            {["shadow-ringo-1", "shadow-ringo-2", "shadow-ringo-3", "shadow-ringo-glow", "shadow-ringo-signal"].map((s) => (
              <div key={s} className={`flex h-20 w-32 items-center justify-center rounded-ringo-md bg-ringo-surface text-xs ${s}`}>
                {s.replace("shadow-", "")}
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 text-xs">
            <div className="flex h-16 w-32 items-center justify-center rounded-ringo-md border border-ringo-border">neutral</div>
            <div className="flex h-16 w-32 items-center justify-center rounded-ringo-md border border-ringo-line-warm">warm</div>
            <div className="ringo-gilt flex h-16 w-32 items-center justify-center rounded-ringo-md">gilt edge</div>
            <div className="ringo-gilt ringo-gilt--strong flex h-16 w-32 items-center justify-center rounded-ringo-md">gilt strong</div>
          </div>
        </div>

        <div className="ringo-lamp overflow-hidden rounded-ringo-xl bg-ringo-ink p-6 text-ringo-paper sm:p-10" style={{ ["--lamp-x" as string]: "20%", ["--lamp-y" as string]: "0%" }}>
          <h2 className="font-display text-xl font-semibold">Dark stage: lamplight, glass, press</h2>
          <div className="mt-6 flex flex-wrap items-center gap-4">
            <div className="ringo-glass ringo-glass--ink rounded-ringo-lg px-5 py-4 text-sm">Glass on ink</div>
            <button type="button" className="ringo-press ringo-focus rounded-full bg-ringo-gold px-6 py-3 text-sm font-semibold text-ringo-ink">
              Press me
            </button>
            <MicroLabel surface="dark" tone="signal" live>
              {t.brand.card.connected}
            </MicroLabel>
            <MicroLabel surface="dark" tone="gold">
              {t.brand.card.nfcReady}
            </MicroLabel>
            <MicroLabel surface="dark" tone="muted">
              {t.brand.micro.scanToOpen}
            </MicroLabel>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="font-display text-xl font-semibold">The Ring</h2>
          <div className="flex flex-wrap items-end gap-8 rounded-ringo-lg bg-ringo-ink p-6">
            {CONNECT_STATES.map((s) => (
              <figure key={s} className="space-y-2 text-center">
                <Ring size={72} state={s} label={t.brand.ring[s]} />
                <figcaption className="ringo-micro text-ringo-stone-300/80">{s}</figcaption>
              </figure>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-8 rounded-ringo-lg bg-ringo-paper p-6">
            {CONNECT_STATES.map((s) => (
              <Ring key={s} size={32} state={s} />
            ))}
            <MicroLabel surface="light" tone="gold">
              {t.brand.card.nfcReady}
            </MicroLabel>
            <MicroLabel surface="light" tone="signal" live>
              {t.brand.card.connected}
            </MicroLabel>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="font-display text-xl font-semibold">Ringo Card</h2>
          <div className="flex flex-wrap items-center gap-3">
            {CONNECT_STATES.map((s) => (
              <button key={s} type="button" onClick={() => setState(s)} aria-pressed={state === s} className="ringo-press ringo-focus rounded-full border border-ringo-border px-4 py-2 text-sm aria-pressed:bg-ringo-text aria-pressed:text-ringo-bg">
                {s}
              </button>
            ))}
            <button type="button" onClick={() => setState((s) => nextConnectState(s, s === "idle" ? "tap" : s === "waiting" ? "confirm" : "reset"))} className="ringo-press ringo-focus rounded-full bg-ringo-accent px-4 py-2 text-sm text-ringo-on-accent">
              step
            </button>
          </div>
          <div className="flex flex-wrap gap-10 rounded-ringo-xl bg-ringo-ink p-6 sm:p-10">
            <RingoCard3D name="Marie-Antoinette Ngono Bikoï" ringoId="0042" state={state} />
            <RingoCard3D name="Chez Ali" ringoId="0107" state={state} interactive={false} />
          </div>
        </div>
      </section>
    </main>
  );
}
