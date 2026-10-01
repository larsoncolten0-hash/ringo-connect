"use client";

import { useState } from "react";
import { Download, Loader2 } from "lucide-react";

// Downloads the PDF of an existing Shop receipt. Presentation only: the server decides whether a PDF exists and what it contains.
export default function ShopReceiptPdfButton({ href, label, busyLabel, errorLabel, className, style }: { href: string; label: string; busyLabel: string; errorLabel: string; className: string; style?: React.CSSProperties }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const go = async () => {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(href);
      if (!res.ok) throw new Error("pdf_failed");
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") || "")?.[1] || "receipt.pdf";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <button type="button" onClick={() => void go()} disabled={busy} aria-busy={busy} className={className} style={style}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
        {busy ? busyLabel : label}
      </button>
      {failed && (
        <p role="alert" className="text-xs" style={{ color: "#DC2626" }}>
          {errorLabel}
        </p>
      )}
    </div>
  );
}
