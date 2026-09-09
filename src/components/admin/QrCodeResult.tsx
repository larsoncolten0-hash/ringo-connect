"use client";

import { useEffect, useRef, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { drawQrCodeWithLogo, downloadCanvas } from "@/lib/qrCode";

// Auto-generates a QR code the moment it mounts — no input needed, since
// the target URL (the new account's page) is already known once a signup
// request has been approved. Shown inside RequestReview's "account
// created" panel, right next to the username/password. See
// src/lib/qrCode.ts for the shared draw/download logic also used by the
// full QR code builder (src/components/dashboard/QrCodeGenerator.tsx).
export default function QrCodeResult({ url, filename }: { url: string; filename: string }) {
  const [status, setStatus] = useState<"generating" | "ready" | "error">("generating");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const SIZE = 512;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    setStatus("generating");

    drawQrCodeWithLogo(canvas, url, SIZE)
      .then(() => {
        if (!cancelled) setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  const download = (format: "png" | "jpeg") => {
    const canvas = canvasRef.current;
    if (!canvas || status !== "ready") return;
    downloadCanvas(canvas, `${filename}-qr`, format);
  };

  return (
    <div className="flex items-center gap-4 rounded-card border border-ringo-border bg-ringo-surface p-3">
      <div
        className="shrink-0 rounded-card border border-ringo-border/70 bg-white p-2 flex items-center justify-center"
        style={{ width: 96, height: 96 }}
      >
        {status === "generating" ? (
          <Loader2 size={18} className="animate-spin text-ringo-muted" />
        ) : status === "error" ? (
          <span className="text-[10px] text-ringo-coral text-center px-1">Couldn&apos;t generate code</span>
        ) : (
          <canvas ref={canvasRef} className="max-w-full max-h-full" />
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-ringo-muted">QR code for their page, logo included.</p>
        <div className="flex gap-2">
          <button
            onClick={() => download("png")}
            disabled={status !== "ready"}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white disabled:opacity-50"
          >
            <Download size={13} /> PNG
          </button>
          <button
            onClick={() => download("jpeg")}
            disabled={status !== "ready"}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text disabled:opacity-50"
          >
            <Download size={13} /> JPEG
          </button>
        </div>
      </div>
    </div>
  );
}
