"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Inbox } from "lucide-react";

const STATUS_ORDER: Record<string, number> = { pending: 0, approved: 1, rejected: 2 };

export default function RequestsTable({ requests }: { requests: any[] }) {
  const router = useRouter();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const sorted = [...requests].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const pendingCount = requests.filter((r) => r.status === "pending").length;

  const deleteRequest = async (id: string) => {
    if (!window.confirm("Delete this request and everything submitted with it? This can't be undone.")) return;
    setDeletingId(id);
    const res = await fetch(`/api/admin/requests/${id}/delete`, { method: "POST" });
    setDeletingId(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Could not delete this request.");
      return;
    }
    router.refresh();
  };

  return (
    <div className="max-w-4xl flex flex-col gap-4">
      <div>
        <h1 className="font-display text-xl font-medium text-ringo-text tracking-[-0.01em]">Signup requests</h1>
        <p className="text-sm text-ringo-muted mt-0.5">
          {pendingCount} pending{requests.length > pendingCount && ` · ${requests.length} total`}
        </p>
      </div>

      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface shadow-[0_1px_2px_rgba(15,23,42,0.04)] overflow-hidden">
        {sorted.length === 0 ? (
          <div className="flex flex-col items-center text-center gap-2 py-16">
            <span className="w-10 h-10 rounded-full bg-ringo-muted/10 flex items-center justify-center">
              <Inbox size={16} className="text-ringo-muted" />
            </span>
            <p className="text-sm text-ringo-muted">No signup requests yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[680px]">
              <thead>
                <tr className="text-left text-ringo-muted border-b border-ringo-border/70">
                  <th className="py-3 px-4 font-normal">Name</th>
                  <th className="font-normal">WhatsApp</th>
                  <th className="font-normal">Plan requested</th>
                  <th className="font-normal">Status</th>
                  <th className="font-normal">Submitted</th>
                  <th className="font-normal px-4"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const initial = (r.full_name || "?")[0].toUpperCase();
                  return (
                    <tr key={r.id} className="border-b border-ringo-border/40 last:border-0 hover:bg-ringo-muted/5 transition-colors">
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          {r.avatar_url ? (
                            <img src={r.avatar_url} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                          ) : (
                            <span className="w-8 h-8 rounded-full bg-ringo-indigo/10 text-ringo-indigo text-xs font-medium flex items-center justify-center shrink-0">
                              {initial}
                            </span>
                          )}
                          <p className="text-ringo-text font-medium truncate max-w-[160px]">{r.full_name}</p>
                        </div>
                      </td>
                      <td className="text-ringo-muted">{r.whatsapp_number}</td>
                      <td className="text-ringo-text capitalize">
                        {r.plans?.display_name || r.plans?.name || "—"}
                      </td>
                      <td>
                        <span
                          className={`text-xs px-2.5 py-1 rounded-full font-medium capitalize ${
                            r.status === "pending"
                              ? "bg-ringo-indigo/10 text-ringo-indigo"
                              : r.status === "approved"
                              ? "bg-ringo-teal/10 text-ringo-teal"
                              : "bg-red-500/10 text-red-500"
                          }`}
                        >
                          {r.status}
                        </span>
                      </td>
                      <td className="text-ringo-muted">{new Date(r.created_at).toLocaleDateString("en-US")}</td>
                      <td className="px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link
                            href={`/admin/requests/${r.id}`}
                            className="text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text hover:border-ringo-indigo hover:text-ringo-indigo transition-colors"
                          >
                            Review
                          </Link>
                          {r.status !== "approved" && (
                            <button
                              onClick={() => deleteRequest(r.id)}
                              disabled={deletingId === r.id}
                              className="text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-muted hover:border-red-500 hover:text-red-500 transition-colors disabled:opacity-50"
                            >
                              {deletingId === r.id ? "Deleting…" : "Delete"}
                            </button>
                          )}
                        </div>
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