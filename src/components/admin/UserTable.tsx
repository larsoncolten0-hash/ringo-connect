"use client";

import { useMemo, useState } from "react";
import { Search, Users } from "lucide-react";

export default function UserTable({ users, plans }: { users: any[]; plans: any[] }) {
  const [rows, setRows] = useState(users);
  const [query, setQuery] = useState("");

  const patch = async (id: string, body: any) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...body } : r)));
    const res = await fetch(`/api/admin/users/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      // Revert on failure rather than leaving the UI showing a change
      // that didn't actually save.
      setRows(users);
    }
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (u) => u.email?.toLowerCase().includes(q) || u.profiles?.[0]?.username?.toLowerCase().includes(q)
    );
  }, [rows, query]);

  const planName = (planId: string) => plans.find((p) => p.id === planId)?.name || "free";

  return (
    <div className="max-w-5xl flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">Creators</h1>
          <p className="text-sm text-ringo-muted mt-0.5">
            {rows.length} total{query && ` · ${filtered.length} matching`}
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ringo-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by username or email"
            className="w-full pl-9 pr-3 py-2 text-sm border border-ringo-border rounded-card bg-ringo-surface text-ringo-text"
          />
        </div>
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-16">
            <span className="w-10 h-10 rounded-full bg-ringo-muted/10 flex items-center justify-center">
              <Users size={16} className="text-ringo-muted" />
            </span>
            <p className="text-sm text-ringo-muted">
              {query ? "No creators match that search." : "No creators yet."}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-4 font-normal">Creator</th>
                  <th className="font-normal">Plan</th>
                  <th className="font-normal">Status</th>
                  <th className="font-normal">Joined</th>
                  <th className="font-normal text-right px-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => {
                  const username = u.profiles?.[0]?.username;
                  const initial = (username || u.email || "?")[0].toUpperCase();
                  const active = u.status === "active";

                  return (
                    <tr key={u.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <span className="w-8 h-8 rounded-full bg-ringo-indigo/10 text-ringo-indigo text-xs font-medium flex items-center justify-center shrink-0">
                            {initial}
                          </span>
                          <div className="min-w-0">
                            <p className="text-ringo-text font-medium truncate">
                              {username ? `@${username}` : "No profile"}
                            </p>
                            <p className="text-xs text-ringo-muted truncate">{u.email}</p>
                          </div>
                        </div>
                      </td>
                      <td>
                        <select
                          value={u.plan_id}
                          onChange={(e) => patch(u.id, { plan_id: e.target.value })}
                          className="text-xs px-2.5 py-1.5 rounded-full border border-ringo-border bg-ringo-bg text-ringo-text capitalize"
                        >
                          {plans.map((p) => (
                            <option key={p.id} value={p.id} className="capitalize">
                              {p.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                            active ? "bg-ringo-teal/10 text-ringo-teal" : "bg-red-500/10 text-red-500"
                          }`}
                        >
                          {active ? "Active" : "Suspended"}
                        </span>
                      </td>
                      <td className="text-ringo-muted">{new Date(u.created_at).toLocaleDateString()}</td>
                      <td className="text-right px-4">
                        <button
                          onClick={() => patch(u.id, { status: active ? "suspended" : "active" })}
                          className={`text-xs px-3 py-1.5 rounded-card border transition-colors ${
                            active
                              ? "border-ringo-border text-ringo-text hover:border-red-400 hover:text-red-500"
                              : "border-ringo-teal/40 text-ringo-teal hover:bg-ringo-teal/10"
                          }`}
                        >
                          {active ? "Suspend" : "Reactivate"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}