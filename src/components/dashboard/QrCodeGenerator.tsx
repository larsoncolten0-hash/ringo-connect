"use client";

import { useEffect, useRef, useState } from "react";
import { Download, ImageOff, Link as LinkIcon, QrCode as QrCodeIcon } from "lucide-react";
import { drawQrCodeWithLogo, downloadCanvas } from "@/lib/qrCode";

type Customer = { username: string; name: string | null };

const SIZE_OPTIONS = [
  { label: "Small — 256 × 256", value: 256 },
  { label: "Medium — 512 × 512", value: 512 },
  { label: "Large — 1024 × 1024", value: 1024 },
];

export default function QrCodeGenerator({
  customers,
  siteUrl,
}: {
  // Every creator's page, for the "pick a customer" shortcut below — see
  // src/app/dashboard/qr-code/page.tsx. Typing/pasting a link works too,
  // so this list is a convenience, not a requirement.
  customers: Customer[];
  siteUrl: string;
}) {
  const [selectedUsername, setSelectedUsername] = useState("");
  const [url, setUrl] = useState("");
  const [size, setSize] = useState(512);
  const [status, setStatus] = useState<"idle" | "generating" | "ready" | "error">("idle");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const selectCustomer = (username: string) => {
    setSelectedUsername(username);
    if (username) setUrl(`${siteUrl.replace(/\/$/, "")}/${username}`);
  };

  useEffect(() => {
    const target = url.trim();
    const canvas = canvasRef.current;
    if (!target || !canvas) {
      setStatus("idle");
      return;
    }

    let cancelled = false;
    setStatus("generating");

    // Small debounce so typing a URL by hand doesn't redraw on every
    // keystroke — the logo overlay makes each draw a bit more work than a
    // plain QR render.
    const timer = setTimeout(async () => {
      try {
        await drawQrCodeWithLogo(canvas, target, size);
        if (!cancelled) setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [url, size]);

  const download = (format: "png" | "jpeg") => {
    const canvas = canvasRef.current;
    if (!canvas || status !== "ready") return;
    downloadCanvas(canvas, `${selectedUsername || "ringo-connect"}-qr`, format);
  };

  return (
    <div className="max-w-2xl">
      <div className="flex items-center gap-2.5 mb-1">
        <QrCodeIcon size={20} className="text-ringo-indigo" strokeWidth={2.2} />
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">QR code builder</h1>
      </div>
      <p className="text-sm text-ringo-muted mb-6">
        Generate a scannable QR code for a customer&apos;s page — the Ringo Connect logo sits at the center. Download
        it as a PNG or JPEG. Only admins and super creators can see this.
      </p>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-4">
        {customers.length > 0 && (
          <label className="flex flex-col gap-1">
            <span className="text-xs text-ringo-muted">Pick a customer&apos;s page</span>
            <select
              value={selectedUsername}
              onChange={(e) => selectCustomer(e.target.value)}
              className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text"
            >
              <option value="">— choose a customer —</option>
              {customers.map((c) => (
                <option key={c.username} value={c.username}>
                  {c.name ? `${c.name} (@${c.username})` : `@${c.username}`}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="flex flex-col gap-1">
          <span className="text-xs text-ringo-muted flex items-center gap-1">
            <LinkIcon size={12} /> Link or URL
          </span>
          <input
            type="text"
            value={url}
            onChange={(e) => {
              setSelectedUsername("");
              setUrl(e.target.value);
            }}
            placeholder={`${siteUrl}/username`}
            className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text font-mono"
          />
        </label>

        <label className="flex flex-col gap-1 max-w-[220px]">
          <span className="text-xs text-ringo-muted">Size</span>
          <select
            value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text"
          >
            {SIZE_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <div className="flex flex-col items-center gap-4 pt-4 border-t border-ringo-border/70">
          <div
            className="rounded-card border border-ringo-border/70 bg-white p-3 flex items-center justify-center shrink-0"
            style={{ width: 260, height: 260 }}
          >
            {url.trim() ? (
              <canvas ref={canvasRef} className="max-w-full max-h-full" />
            ) : (
              <div className="flex flex-col items-center gap-2 text-ringo-muted text-center px-4">
                <ImageOff size={28} strokeWidth={1.5} />
                <span className="text-xs">Pick a customer above, or paste a link, to preview the code</span>
              </div>
            )}
          </div>

          {status === "error" && (
            <p className="text-xs text-ringo-coral">
              Couldn&apos;t generate a QR code for that link — check it and try again.
            </p>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => download("png")}
              disabled={status !== "ready"}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white disabled:opacity-50"
            >
              <Download size={13} /> Download PNG
            </button>
            <button
              onClick={() => download("jpeg")}
              disabled={status !== "ready"}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text disabled:opacity-50"
            >
              <Download size={13} /> Download JPEG
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
