"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { TemplateRow } from "@/lib/loyalty/templates";
import type { LoyaltyActionKey } from "@/lib/loyalty/categories";
import { actionText, api, codeOf, fmtMoney, outcomeText } from "@/components/loyalty/format";

const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-ringo-indigo px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50";
const btnGhost = "inline-flex items-center justify-center gap-1.5 rounded-xl border border-ringo-border px-3 py-2 text-sm font-medium text-ringo-text disabled:opacity-50";
const inputCls = "w-full rounded-xl border border-ringo-border bg-ringo-bg px-3 py-2.5 text-sm text-ringo-text focus:outline-none focus:ring-2 focus:ring-ringo-indigo/30";

type Row = { action_key: string; quantity: string };

// What the business sells. A package reads like: "10 Haircuts · Valid 30 days". Selling one is
// done from a customer's profile (Scan tab), manually, after the business has been paid.
export default function PackageTemplates({
  templates,
  actions,
}: {
  templates: TemplateRow[];
  actions: LoyaltyActionKey[];
}) {
  const { t, locale } = useLanguage();
  const L = t.loyalty;
  const router = useRouter();
  const [editing, setEditing] = useState<"new" | string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("30");
  const [carry, setCarry] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  function open(tpl: TemplateRow | null) {
    setNotice(null);
    if (!tpl) {
      setEditing("new");
      setName("");
      setPrice("");
      setDuration("30");
      setCarry(false);
      setRows([{ action_key: actions[0], quantity: "1" }]);
      return;
    }
    setEditing(tpl.id);
    setName(tpl.name);
    setPrice(tpl.price === null ? "" : String(tpl.price));
    setDuration(String(tpl.duration_days));
    setCarry(tpl.carry_over);
    setRows(tpl.loyalty_package_template_items.map((i) => ({ action_key: i.action_key, quantity: String(i.quantity) })));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !editing) return;
    const items = rows.map((r) => ({ action_key: r.action_key, quantity: /^\d+$/.test(r.quantity) ? Number(r.quantity) : 0 }));
    const dur = /^\d+$/.test(duration) ? Number(duration) : 0;
    if (!name.trim() || items.length === 0 || items.some((i) => i.quantity < 1) || dur < 1) return setNotice({ kind: "error", text: L.outcomes.invalid_request });
    setBusy(true);
    setNotice(null);
    const body = { name: name.trim(), price: price.trim() === "" ? null : Number(price), duration_days: dur, carry_over: carry, items };
    const res = editing === "new" ? await api("/api/loyalty/packages/templates", { body }) : await api(`/api/loyalty/packages/templates/${editing}`, { method: "PATCH", body });
    setBusy(false);
    if (res.status === 200 || res.status === 201) {
      setNotice({ kind: "ok", text: L.packages.saved });
      setEditing(null);
      router.refresh();
    } else setNotice({ kind: "error", text: res.status === 0 ? L.scan.network : outcomeText(L, codeOf(res)) });
  }

  async function setActive(tpl: TemplateRow, active: boolean) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    const res = await api(`/api/loyalty/packages/templates/${tpl.id}`, { method: "PATCH", body: { active } });
    setBusy(false);
    if (res.status === 200) router.refresh();
    else setNotice({ kind: "error", text: res.status === 0 ? L.scan.network : outcomeText(L, codeOf(res)) });
  }

  const used = new Set(rows.map((r) => r.action_key));

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ringo-muted">{L.packages.intro}</p>

      {notice && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm font-medium ${notice.kind === "ok" ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
          {notice.text}
        </p>
      )}

      {editing === null && (
        <button type="button" onClick={() => open(null)} className={`${btnPrimary} self-start`}>
          <Plus size={16} /> {L.packages.newTemplate}
        </button>
      )}

      {editing !== null && (
        <form onSubmit={save} className="flex flex-col gap-4 rounded-card border border-ringo-indigo/30 bg-ringo-indigo/[0.03] p-5">
          <h2 className="text-base font-semibold text-ringo-text">{editing === "new" ? L.packages.newTemplate : L.packages.editTemplate}</h2>
          <label className="flex flex-col gap-1 text-xs font-medium text-ringo-muted">
            {L.packages.nameLabel}
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder={L.packages.namePlaceholder} className={inputCls} />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-medium text-ringo-muted">
              {L.packages.priceLabel}
              <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/\D/g, ""))} className={inputCls} />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ringo-muted">
              {L.packages.durationLabel}
              <input inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))} className={inputCls} />
            </label>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-ringo-muted">{L.packages.itemsLabel}</p>
            {rows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={r.action_key}
                  onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, action_key: e.target.value } : x)))}
                  className={`${inputCls} flex-1`}
                  aria-label={L.packages.itemsLabel}
                >
                  {actions.map((a) => (
                    <option key={a} value={a} disabled={used.has(a) && a !== r.action_key}>
                      {actionText(L, a).many}
                    </option>
                  ))}
                </select>
                <input
                  inputMode="numeric"
                  aria-label={L.packages.quantityLabel}
                  value={r.quantity}
                  onChange={(e) => setRows((prev) => prev.map((x, j) => (j === i ? { ...x, quantity: e.target.value.replace(/\D/g, "") } : x)))}
                  className="w-20 rounded-xl border border-ringo-border bg-ringo-bg px-2 py-2.5 text-center text-sm"
                />
                <button type="button" aria-label={L.packages.removeItem} disabled={rows.length <= 1} onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} className="text-ringo-muted disabled:opacity-30">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {rows.length < Math.min(actions.length, 10) && (
              <button
                type="button"
                className={`${btnGhost} self-start`}
                onClick={() => {
                  const next = actions.find((a) => !used.has(a));
                  if (next) setRows((prev) => [...prev, { action_key: next, quantity: "1" }]);
                }}
              >
                <Plus size={14} /> {L.packages.addItem}
              </button>
            )}
          </div>

          <label className="flex items-center gap-2 text-sm text-ringo-text">
            <input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} /> {L.packages.carryOverLabel}
          </label>

          <div className="flex gap-2">
            <button type="submit" disabled={busy} className={btnPrimary}>
              {busy ? <><Loader2 size={15} className="animate-spin" /> {L.packages.saving}</> : L.packages.save}
            </button>
            <button type="button" onClick={() => setEditing(null)} disabled={busy} className={btnGhost}>
              {L.setup.cancel}
            </button>
          </div>
        </form>
      )}

      {templates.length === 0 && editing === null && <p className="rounded-card border border-ringo-border/70 bg-ringo-surface p-6 text-center text-sm text-ringo-muted">{L.packages.empty}</p>}

      <div className="flex flex-col gap-3">
        {templates.map((tpl) => (
          <div key={tpl.id} className={`flex flex-col gap-2 rounded-card border border-ringo-border/70 bg-ringo-surface p-4 ${tpl.active ? "" : "opacity-60"}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ringo-text">
                  {tpl.name}
                  {!tpl.active && <span className="ml-2 rounded-full bg-ringo-muted/15 px-2 py-0.5 text-[10px] font-semibold text-ringo-muted">{L.packages.archived}</span>}
                </p>
                <p className="text-xs text-ringo-muted">
                  {tpl.price !== null ? `${fmtMoney(tpl.price, tpl.currency, locale)} · ` : ""}
                  {L.packages.days(tpl.duration_days)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button type="button" className={btnGhost} onClick={() => open(tpl)} disabled={busy}>
                  {L.setup.edit}
                </button>
                <button type="button" className={btnGhost} onClick={() => setActive(tpl, !tpl.active)} disabled={busy}>
                  {tpl.active ? L.packages.archive : L.packages.restore}
                </button>
              </div>
            </div>
            <p className="text-sm text-ringo-text">
              <span className="text-ringo-muted">{L.packages.includes}: </span>
              {tpl.loyalty_package_template_items.map((i) => `${i.quantity} ${actionText(L, i.action_key).many}`).join(" · ")}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
