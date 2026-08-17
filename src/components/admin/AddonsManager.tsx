"use client";

import { useState } from "react";
import { Check, Plus, X } from "lucide-react";

export default function AddonsManager({ addons }: { addons: any[] }) {
  const [rows, setRows] = useState(addons);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newAddon, setNewAddon] = useState({ name: "", price_xaf: "", price_usd: "", required: false });
  const [creating, setCreating] = useState(false);

  const updateField = (id: string, field: string, value: any) => {
    setRows((prev) => prev.map((a) => (a.id === id ? { ...a, [field]: value } : a)));
  };

  const save = async (addon: any) => {
    setSavingId(addon.id);
    const res = await fetch(`/api/admin/addons/${addon.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: addon.name,
        price_xaf: Number(addon.price_xaf),
        price_usd: Number(addon.price_usd),
        required: addon.required,
        active: addon.active,
      }),
    });
    setSavingId(null);
    if (res.ok) {
      setSavedId(addon.id);
      setTimeout(() => setSavedId(null), 1600);
    }
  };

  const createAddon = async () => {
    if (!newAddon.name.trim()) return;
    setCreating(true);
    const res = await fetch("/api/admin/addons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newAddon),
    });
    setCreating(false);
    if (res.ok) {
      window.location.reload(); // simplest way to get the new row + its id
    }
  };

  return (
    <div className="max-w-3xl flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">Add-ons</h1>
        <p className="text-sm text-ringo-muted mt-1">
          Extras shown alongside plan selection on the get-started form — the same list regardless of which plan
          someone picks. A "required" add-on is pre-selected there and can't be unchecked.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {rows.map((addon) => (
          <div
            key={addon.id}
            className={`rounded-card border border-ringo-border/70 bg-ringo-surface p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] ${
              !addon.active ? "opacity-50" : ""
            }`}
          >
            <div className="flex items-center justify-between mb-3">
              <input
                value={addon.name}
                onChange={(e) => updateField(addon.id, "name", e.target.value)}
                className="text-sm font-medium text-ringo-text bg-transparent border-b border-transparent hover:border-ringo-border focus:border-ringo-indigo focus:outline-none px-0.5 py-0.5"
              />
              <div className="flex items-center gap-2">
                {savedId === addon.id && (
                  <span className="flex items-center gap-1 text-xs text-ringo-teal">
                    <Check size={13} /> Saved
                  </span>
                )}
                <button
                  onClick={() => save(addon)}
                  disabled={savingId === addon.id}
                  className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white disabled:opacity-50"
                >
                  {savingId === addon.id ? "Saving…" : "Save"}
                </button>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 mb-3">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">Price (XAF)</span>
                <input
                  value={addon.price_xaf}
                  onChange={(e) => updateField(addon.id, "price_xaf", e.target.value)}
                  className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">Price (USD)</span>
                <input
                  value={addon.price_usd}
                  onChange={(e) => updateField(addon.id, "price_usd", e.target.value)}
                  className="border border-ringo-border rounded-card px-2.5 py-1.5 text-sm bg-ringo-bg text-ringo-text"
                />
              </label>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-ringo-text">
                <input
                  type="checkbox"
                  checked={!!addon.required}
                  onChange={(e) => updateField(addon.id, "required", e.target.checked)}
                  className="accent-ringo-indigo"
                />
                Required (pre-selected, can't be unchecked)
              </label>
              <label className="flex items-center gap-2 text-sm text-ringo-text">
                <input
                  type="checkbox"
                  checked={!!addon.active}
                  onChange={(e) => updateField(addon.id, "active", e.target.checked)}
                  className="accent-ringo-indigo"
                />
                Active (shown on the form)
              </label>
            </div>
          </div>
        ))}

        {rows.length === 0 && !showNew && (
          <p className="text-sm text-ringo-muted text-center py-8">No add-ons yet.</p>
        )}
      </div>

      {!showNew ? (
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 text-sm font-medium text-ringo-indigo w-fit"
        >
          <Plus size={15} />
          Add a new add-on
        </button>
      ) : (
        <div className="rounded-card border border-ringo-border bg-ringo-surface p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ringo-text">New add-on</p>
            <button onClick={() => setShowNew(false)} className="text-ringo-muted hover:text-ringo-text">
              <X size={16} />
            </button>
          </div>
          <input
            value={newAddon.name}
            onChange={(e) => setNewAddon({ ...newAddon, name: e.target.value })}
            placeholder="e.g. Ringo Connect Wireless Card"
            className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
          <div className="grid sm:grid-cols-2 gap-3">
            <input
              value={newAddon.price_xaf}
              onChange={(e) => setNewAddon({ ...newAddon, price_xaf: e.target.value })}
              placeholder="Price (XAF)"
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
            <input
              value={newAddon.price_usd}
              onChange={(e) => setNewAddon({ ...newAddon, price_usd: e.target.value })}
              placeholder="Price (USD)"
              className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-ringo-text">
            <input
              type="checkbox"
              checked={newAddon.required}
              onChange={(e) => setNewAddon({ ...newAddon, required: e.target.checked })}
              className="accent-ringo-indigo"
            />
            Required for everyone
          </label>
          <button
            onClick={createAddon}
            disabled={creating || !newAddon.name.trim()}
            className="text-sm font-medium px-4 py-2 rounded-card bg-ringo-indigo text-white disabled:opacity-50 w-fit"
          >
            {creating ? "Creating…" : "Create add-on"}
          </button>
        </div>
      )}
    </div>
  );
}