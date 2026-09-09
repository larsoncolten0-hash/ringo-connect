"use client";

import { useEffect, useRef, useState } from "react";
import { QrCode as QrCodeIcon, Download, Printer, RefreshCw, X, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { drawQrCodeWithLogo, downloadCanvas } from "@/lib/qrCode";
import EditorCard from "./EditorCard";

// Only ever rendered for a profile tagged Restaurant & Food. Reuses the
// same QR drawing/download logic as the admin QR builder (src/lib/qrCode.ts)
// — a table's QR is just a link with ?table=<public_code> appended, same
// mechanism as any other Ringo QR code, not a separate system.
export default function TablesCard({
  profileId,
  username,
  siteUrl,
  initialTables,
}: {
  profileId: string;
  username: string;
  siteUrl: string;
  initialTables: any[];
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [tables, setTables] = useState([...initialTables].sort((a, b) => a.sort_order - b.sort_order));
  const [openQrId, setOpenQrId] = useState<string | null>(null);

  const tableUrl = (code: string) => `${siteUrl.replace(/\/$/, "")}/r/${username}?table=${code}`;

  const addTable = async () => {
    const { data } = await supabase
      .from("restaurant_tables")
      .insert({ profile_id: profileId, label: `Table ${String(tables.length + 1).padStart(2, "0")}`, sort_order: tables.length })
      .select()
      .single();
    if (data) setTables((prev) => [...prev, data]);
  };

  const renameTable = async (id: string, label: string) => {
    setTables((prev) => prev.map((tb) => (tb.id === id ? { ...tb, label } : tb)));
    await supabase.from("restaurant_tables").update({ label }).eq("id", id);
  };

  const toggleEnabled = async (id: string, enabled: boolean) => {
    setTables((prev) => prev.map((tb) => (tb.id === id ? { ...tb, enabled } : tb)));
    await supabase.from("restaurant_tables").update({ enabled }).eq("id", id);
  };

  const deleteTable = async (id: string) => {
    if (!window.confirm("Delete this table? Its QR code will stop working.")) return;
    setTables((prev) => prev.filter((tb) => tb.id !== id));
    await supabase.from("restaurant_tables").delete().eq("id", id);
  };

  const regenerateCode = async (id: string) => {
    if (!window.confirm(t.restaurant.regenerateQrConfirm)) return;
    // A fresh random code — the DB trigger only auto-assigns one when the
    // column is null, so this has to generate a new one client-side. Not
    // security-critical (it's a menu link, not a secret), just needs to be
    // unguessable and not collide — a 10-char random hex string is enough
    // at table-per-restaurant scale.
    const fresh = Array.from(crypto.getRandomValues(new Uint8Array(5)))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase();
    setTables((prev) => prev.map((tb) => (tb.id === id ? { ...tb, public_code: fresh } : tb)));
    await supabase.from("restaurant_tables").update({ public_code: fresh }).eq("id", id);
  };

  return (
    <EditorCard
      icon={QrCodeIcon}
      title={t.restaurant.tablesTitle}
      action={
        <button onClick={addTable} className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white whitespace-nowrap">
          {t.restaurant.addTable}
        </button>
      }
    >
      <p className="text-xs text-ringo-muted -mt-2 mb-3">{t.restaurant.tablesHint}</p>

      {tables.length === 0 && <p className="text-sm text-ringo-muted">{t.restaurant.noTablesYet}</p>}

      <div className="flex flex-col gap-2">
        {tables.map((table) => (
          <div key={table.id} className="border border-ringo-border rounded-card p-2.5">
            <div className="flex items-center gap-2">
              <input
                value={table.label}
                onChange={(e) => setTables((prev) => prev.map((tb) => (tb.id === table.id ? { ...tb, label: e.target.value } : tb)))}
                onBlur={(e) => renameTable(table.id, e.target.value)}
                placeholder={t.restaurant.tableLabelPlaceholder}
                className="flex-1 min-w-0 text-sm font-medium bg-transparent text-ringo-text px-1 py-1"
              />
              <label className="flex items-center gap-1.5 text-xs text-ringo-muted shrink-0 cursor-pointer">
                <input
                  type="checkbox"
                  checked={table.enabled !== false}
                  onChange={(e) => toggleEnabled(table.id, e.target.checked)}
                  className="accent-ringo-indigo"
                />
                {table.enabled !== false ? t.restaurant.tableEnabled : t.restaurant.tableDisabled}
              </label>
              <button
                onClick={() => setOpenQrId(openQrId === table.id ? null : table.id)}
                className="shrink-0 text-xs font-medium text-ringo-indigo px-2 py-1"
              >
                {t.restaurant.viewQr}
              </button>
              <button onClick={() => deleteTable(table.id)} className="shrink-0 text-ringo-muted hover:text-red-500 p-1">
                <Trash2 size={14} />
              </button>
            </div>

            {openQrId === table.id && (
              <TableQrPanel
                url={tableUrl(table.public_code)}
                label={table.label}
                onRegenerate={() => regenerateCode(table.id)}
                onClose={() => setOpenQrId(null)}
              />
            )}
          </div>
        ))}
      </div>
    </EditorCard>
  );
}

function TableQrPanel({
  url,
  label,
  onRegenerate,
  onClose,
}: {
  url: string;
  label: string;
  onRegenerate: () => void;
  onClose: () => void;
}) {
  const { t } = useLanguage();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(false);
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawQrCodeWithLogo(canvas, url, 384)
      .then(() => setReady(true))
      .catch(() => setReady(false));
  }, [url]);

  const printQr = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dataUrl = canvas.toDataURL("image/png");
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(`
      <html><head><title>${label}</title></head>
      <body style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
        <img src="${dataUrl}" style="width:320px;height:320px" />
        <p style="font-size:20px;font-weight:600;margin-top:16px;">${label}</p>
        <script>window.onload = () => window.print();</script>
      </body></html>
    `);
    win.document.close();
  };

  return (
    <div className="mt-2.5 pt-2.5 border-t border-ringo-border flex flex-col items-center gap-3">
      <div className="w-full flex justify-end">
        <button onClick={onClose} className="text-ringo-muted p-0.5">
          <X size={14} />
        </button>
      </div>
      <div className="rounded-card border border-ringo-border bg-white p-2.5" style={{ width: 180, height: 180 }}>
        <canvas ref={canvasRef} className="max-w-full max-h-full" />
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => canvasRef.current && downloadCanvas(canvasRef.current, `table-${label}`, "png")}
          disabled={!ready}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-card bg-ringo-indigo text-white disabled:opacity-50"
        >
          <Download size={12} /> {t.restaurant.downloadQr}
        </button>
        <button
          onClick={printQr}
          disabled={!ready}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-card border border-ringo-border text-ringo-text disabled:opacity-50"
        >
          <Printer size={12} /> {t.restaurant.printQr}
        </button>
        <button
          onClick={onRegenerate}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-card border border-ringo-border text-ringo-text"
        >
          <RefreshCw size={12} /> {t.restaurant.regenerateQr}
        </button>
      </div>
    </div>
  );
}
