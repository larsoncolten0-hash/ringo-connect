"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  ArrowLeft,
  Check,
  Loader2,
  RefreshCw,
  AlertTriangle,
} from "lucide-react";

type UsernameStatus = "idle" | "checking" | "available" | "taken";
type ChargeStatus = "idle" | "sending" | "pending" | "success" | "failed";

export default function RequestReview({ request, plans, addons }: { request: any; plans: any[]; addons: any[] }) {
  const supabase = createClient();

  // Editable, pre-filled from what the customer submitted — admin can
  // correct typos before creating anything.
  const [fullName, setFullName] = useState(request.full_name || "");
  const [whatsappNumber, setWhatsappNumber] = useState(request.whatsapp_number || "");
  const [note, setNote] = useState(request.business_note || "");
  const [username, setUsername] = useState(request.suggested_username || "");
  const [email, setEmail] = useState(request.email || "");
  const [password, setPassword] = useState("");
  const [planId, setPlanId] = useState(request.requested_plan_id || plans[0]?.id || "");
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">(
    request.requested_interval === "yearly" ? "yearly" : "monthly"
  );
  const [paymentMethod, setPaymentMethod] = useState<"charge" | "manual">("charge");
  const [chargePhone, setChargePhone] = useState(request.whatsapp_number || "");
  const [chargeMedium, setChargeMedium] = useState<"mobile money" | "orange money">("mobile money");

  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>("idle");
  const [chargeStatus, setChargeStatus] = useState<ChargeStatus>(request.customer_paid ? "success" : "idle");
  const [chargeError, setChargeError] = useState("");

  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [created, setCreated] = useState<{ username: string } | null>(null);

  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  const pollTimer = useRef<ReturnType<typeof setInterval>>();
  const pollAttempts = useRef(0);

  const selectedPlan = plans.find((p) => p.id === planId);
  const isPaidPlan = selectedPlan && Number(selectedPlan.price_usd) > 0;

  const requestedAddons = addons.filter((a) => (request.requested_addon_ids || []).includes(a.id));
  const addonsTotalXaf = requestedAddons.reduce((sum, a) => sum + Number(a.price_xaf), 0);
  const addonsTotalUsd = requestedAddons.reduce((sum, a) => sum + Number(a.price_usd), 0);
  // A required add-on can mean money is owed even on a free plan — the
  // payment section needs to appear whenever ANYTHING is owed, not just
  // when the plan itself has a price.
  const somethingOwed = isPaidPlan || addonsTotalXaf > 0 || addonsTotalUsd > 0;

  useEffect(() => () => clearInterval(pollTimer.current), []);

  // Live username availability — same pattern as the self-service signup form.
  useEffect(() => {
    if (!username || username.length < 3) {
      setUsernameStatus("idle");
      return;
    }
    setUsernameStatus("checking");
    const timer = setTimeout(async () => {
      const { data } = await supabase.from("profiles").select("id").eq("username", username.toLowerCase()).maybeSingle();
      setUsernameStatus(data ? "taken" : "available");
    }, 400);
    return () => clearTimeout(timer);
  }, [username]);

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
    let pw = "";
    for (let i = 0; i < 10; i++) pw += chars[Math.floor(Math.random() * chars.length)];
    setPassword(pw);
  };

  const sendCharge = async () => {
    setChargeError("");
    setChargeStatus("sending");
    // Wrapped in try/catch so a network error, timeout, or non-JSON error
    // response surfaces as a real failure instead of leaving chargeStatus
    // stuck on "sending" forever with no feedback.
    try {
      const res = await fetch(`/api/admin/requests/${request.id}/charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: chargePhone, medium: chargeMedium, planId, billingInterval }),
      });
      const data = await res.json();

      if (!res.ok) {
        setChargeError(data.error || "Could not start the charge.");
        setChargeStatus("failed");
        return;
      }

      setChargeStatus("pending");
      pollAttempts.current = 0;
      pollTimer.current = setInterval(async () => {
        pollAttempts.current++;
        try {
          const statusRes = await fetch(`/api/admin/requests/${request.id}/charge-status`);
          const statusData = await statusRes.json();

          if (statusData.status === "SUCCESSFUL") {
            clearInterval(pollTimer.current);
            setChargeStatus("success");
          } else if (statusData.status === "FAILED" || statusData.status === "EXPIRED") {
            clearInterval(pollTimer.current);
            setChargeStatus("failed");
            setChargeError("The customer did not confirm the payment.");
          } else if (pollAttempts.current >= 40) {
            clearInterval(pollTimer.current);
            setChargeStatus("failed");
            setChargeError("Timed out waiting for confirmation.");
          }
        } catch {
          // Transient network error while polling — the attempts>=40
          // cutoff above still ends the poll eventually.
        }
      }, 3000);
    } catch (err: any) {
      setChargeError(err.message || "Could not start the charge.");
      setChargeStatus("failed");
    }
  };

  const canCreate =
    username.length >= 3 &&
    usernameStatus === "available" &&
    email.trim() &&
    password.length >= 6 &&
    fullName.trim() &&
    whatsappNumber.trim() &&
    planId &&
    (!somethingOwed || paymentMethod === "manual" || chargeStatus === "success");

  const createAccount = async () => {
    setCreateError("");
    setCreating(true);
    const res = await fetch(`/api/admin/requests/${request.id}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: username.toLowerCase(),
        email: email.trim(),
        password,
        fullName: fullName.trim(),
        whatsappNumber: whatsappNumber.trim(),
        note: note.trim(),
        avatarUrl: request.avatar_url,
        planId,
        billingInterval,
        paymentMethod: somethingOwed ? paymentMethod : "none",
      }),
    });
    const data = await res.json();
    setCreating(false);

    if (!res.ok) {
      setCreateError(data.error || "Could not create the account.");
      return;
    }
    setCreated({ username: data.username });
  };

  const reject = async () => {
    setRejecting(true);
    await fetch(`/api/admin/requests/${request.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: rejectReason }),
    });
    window.location.href = "/admin/requests";
  };

  const deleteRequest = async () => {
    if (!window.confirm("Delete this request and everything submitted with it? This can't be undone.")) return;
    setDeleteError("");
    setDeleting(true);
    const res = await fetch(`/api/admin/requests/${request.id}/delete`, { method: "POST" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setDeleteError(data.error || "Could not delete this request.");
      setDeleting(false);
      return;
    }
    window.location.href = "/admin/requests";
  };

  return (
    <div className="max-w-2xl flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <Link href="/admin/requests" className="flex items-center gap-1.5 text-sm text-ringo-muted w-fit">
          <ArrowLeft size={15} />
          Back to requests
        </Link>
        {request.status !== "approved" && (
          <button
            onClick={deleteRequest}
            disabled={deleting}
            className="text-sm text-ringo-muted hover:text-red-500 transition-colors disabled:opacity-50"
          >
            {deleting ? "Deleting…" : "Delete request"}
          </button>
        )}
      </div>
      {deleteError && (
        <p className="text-sm text-red-500 flex items-center gap-1.5 -mt-2">
          <AlertTriangle size={14} />
          {deleteError}
        </p>
      )}

      {/* Submitted info summary */}
      <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        <div className="flex items-center gap-3 mb-4">
          {request.avatar_url ? (
            <img src={request.avatar_url} alt="" className="w-14 h-14 rounded-full object-cover" />
          ) : (
            <span className="w-14 h-14 rounded-full bg-ringo-indigo/10 text-ringo-indigo font-medium flex items-center justify-center">
              {(request.full_name || "?")[0].toUpperCase()}
            </span>
          )}
          <div>
            <p className="font-medium text-ringo-text">{request.full_name}</p>
            <p className="text-sm text-ringo-muted">{request.whatsapp_number}</p>
          </div>
          <span
            className={`ml-auto text-xs px-2.5 py-1 rounded-full font-medium capitalize ${
              request.status === "pending"
                ? "bg-ringo-indigo/10 text-ringo-indigo"
                : request.status === "approved"
                ? "bg-ringo-teal/10 text-ringo-teal"
                : "bg-red-500/10 text-red-500"
            }`}
          >
            {request.status}
          </span>
        </div>
        {request.business_note && <p className="text-sm text-ringo-muted mb-1">"{request.business_note}"</p>}
        {request.delivery_location && (
          <p className="text-xs text-ringo-muted">Delivery location: {request.delivery_location}</p>
        )}
        {request.email && <p className="text-xs text-ringo-muted">Submitted email: {request.email}</p>}
        {request.suggested_username && (
          <p className="text-xs text-ringo-muted">Requested page name: {request.suggested_username}</p>
        )}
        {request.customer_paid && (
          <p className="text-xs font-medium text-ringo-teal mt-2 flex items-center gap-1.5">
            <Check size={13} /> Customer already paid via Mobile Money — payment confirmed.
          </p>
        )}

        {(request.requested_links?.length > 0 ||
          request.requested_products?.length > 0 ||
          request.requested_social_links?.length > 0) && (
          <div className="mt-4 pt-4 border-t border-ringo-border flex flex-col gap-3">
            {request.requested_links?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-ringo-muted uppercase tracking-wide mb-1.5">
                  Links ({request.requested_links.length})
                </p>
                <div className="flex flex-col gap-1">
                  {request.requested_links.map((l: any, i: number) => (
                    <p key={i} className="text-sm text-ringo-text truncate">
                      {l.title} — <span className="text-ringo-muted">{l.url}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
            {request.requested_products?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-ringo-muted uppercase tracking-wide mb-1.5">
                  Products ({request.requested_products.length})
                </p>
                <div className="flex flex-col gap-1">
                  {request.requested_products.map((p: any, i: number) => (
                    <p key={i} className="text-sm text-ringo-text">
                      {p.name} {p.price ? <span className="text-ringo-muted">— {p.price}</span> : null}
                    </p>
                  ))}
                </div>
              </div>
            )}
            {request.requested_social_links?.length > 0 && (
              <div>
                <p className="text-xs font-medium text-ringo-muted uppercase tracking-wide mb-1.5">
                  Social links ({request.requested_social_links.length})
                </p>
                <div className="flex flex-col gap-1">
                  {request.requested_social_links.map((s: any, i: number) => (
                    <p key={i} className="text-sm text-ringo-text capitalize">
                      {s.platform} — <span className="text-ringo-muted normal-case">{s.url}</span>
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {request.status === "approved" && (
        <div className="rounded-card border border-ringo-teal/30 bg-ringo-teal/5 p-5 text-sm text-ringo-text">
          This request was already approved and turned into an account.
        </div>
      )}
      {request.status === "rejected" && (
        <div className="rounded-card border border-red-500/30 bg-red-500/5 p-5 text-sm text-ringo-text">
          This request was rejected. {request.admin_notes && <span className="text-ringo-muted">Reason: {request.admin_notes}</span>}
        </div>
      )}

      {request.status === "pending" && !created && (
        <>
          <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-4">
            <h2 className="text-sm font-medium text-ringo-text">Create their account</h2>

            <div className="grid sm:grid-cols-2 gap-4">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">Name</span>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-xs text-ringo-muted">WhatsApp number</span>
                <input
                  value={whatsappNumber}
                  onChange={(e) => setWhatsappNumber(e.target.value)}
                  className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-ringo-muted">
                Username{" "}
                {usernameStatus === "checking" && <span className="text-ringo-muted">· checking…</span>}
                {usernameStatus === "available" && <span className="text-ringo-teal">· available</span>}
                {usernameStatus === "taken" && <span className="text-red-500">· already taken</span>}
              </span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                placeholder="e.g. johnmbah"
                className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-ringo-muted">Email</span>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
              />
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-ringo-muted">Password</span>
              <div className="flex gap-2">
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  className="flex-1 border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
                />
                <button
                  type="button"
                  onClick={generatePassword}
                  className="shrink-0 flex items-center gap-1.5 text-xs px-3 rounded-card border border-ringo-border text-ringo-text"
                >
                  <RefreshCw size={12} />
                  Generate
                </button>
              </div>
            </label>

            <label className="flex flex-col gap-1">
              <span className="text-xs text-ringo-muted">Note (shown in About)</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text resize-none"
              />
            </label>
          </div>

          <div className="rounded-card border border-ringo-border/70 bg-ringo-surface p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] flex flex-col gap-4">
            <h2 className="text-sm font-medium text-ringo-text">Plan</h2>

            <div className="flex flex-wrap gap-2">
              {plans.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setPlanId(p.id);
                    setChargeStatus("idle");
                  }}
                  className={`text-xs px-3.5 py-2 rounded-card border transition ${
                    planId === p.id
                      ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo font-medium"
                      : "border-ringo-border text-ringo-text"
                  }`}
                >
                  {p.display_name || p.name}
                </button>
              ))}
            </div>

            {requestedAddons.length > 0 && (
              <div className="rounded-card border border-ringo-border p-3.5 text-sm flex flex-col gap-1">
                <p className="text-xs font-medium text-ringo-muted uppercase tracking-wide mb-1">Requested add-ons</p>
                {requestedAddons.map((a) => (
                  <div key={a.id} className="flex justify-between text-ringo-text">
                    <span>
                      {a.name}
                      {a.required && <span className="text-ringo-indigo text-xs ml-1.5">(required)</span>}
                    </span>
                    <span>{a.price_xaf} XAF</span>
                  </div>
                ))}
              </div>
            )}

            {somethingOwed && (
              <>
                <div className="flex items-center gap-1 bg-ringo-muted/10 rounded-full p-1 w-fit">
                  {(["monthly", "yearly"] as const).map((iv) => (
                    <button
                      key={iv}
                      onClick={() => {
                        setBillingInterval(iv);
                        setChargeStatus("idle");
                      }}
                      className={`text-xs font-medium px-3 py-1 rounded-full transition capitalize ${
                        billingInterval === iv ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"
                      }`}
                    >
                      {iv}
                    </button>
                  ))}
                </div>

                <div className="flex gap-1 bg-ringo-muted/10 rounded-full p-1 w-fit">
                  <button
                    onClick={() => setPaymentMethod("charge")}
                    className={`text-xs font-medium px-3.5 py-1.5 rounded-full transition ${
                      paymentMethod === "charge" ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"
                    }`}
                  >
                    Charge now
                  </button>
                  <button
                    onClick={() => setPaymentMethod("manual")}
                    className={`text-xs font-medium px-3.5 py-1.5 rounded-full transition ${
                      paymentMethod === "manual" ? "bg-ringo-surface text-ringo-text shadow-sm" : "text-ringo-muted"
                    }`}
                  >
                    Already paid (cash/transfer)
                  </button>
                </div>

                {paymentMethod === "charge" && (
                  <div className="flex flex-col gap-3 rounded-card border border-ringo-border p-4">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-ringo-muted">Phone to charge</span>
                        <input
                          value={chargePhone}
                          onChange={(e) => setChargePhone(e.target.value)}
                          disabled={chargeStatus === "pending"}
                          className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-ringo-muted">Provider</span>
                        <select
                          value={chargeMedium}
                          onChange={(e) => setChargeMedium(e.target.value as any)}
                          disabled={chargeStatus === "pending"}
                          className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
                        >
                          <option value="mobile money">MTN Mobile Money</option>
                          <option value="orange money">Orange Money</option>
                        </select>
                      </label>
                    </div>

                    {chargeStatus === "idle" && (
                      <button
                        onClick={sendCharge}
                        className="text-sm font-medium py-2 rounded-card bg-ringo-indigo text-white"
                      >
                        Send charge
                      </button>
                    )}
                    {chargeStatus === "sending" && (
                      <p className="text-sm text-ringo-muted flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" /> Sending request…
                      </p>
                    )}
                    {chargeStatus === "pending" && (
                      <p className="text-sm text-ringo-muted flex items-center gap-2">
                        <Loader2 size={14} className="animate-spin" /> Waiting for the customer to confirm on their
                        phone…
                      </p>
                    )}
                    {chargeStatus === "success" && (
                      <p className="text-sm text-ringo-teal flex items-center gap-2">
                        <Check size={14} /> Payment confirmed.
                      </p>
                    )}
                    {chargeStatus === "failed" && (
                      <div className="flex flex-col gap-2">
                        <p className="text-sm text-red-500 flex items-center gap-2">
                          <AlertTriangle size={14} /> {chargeError}
                        </p>
                        <button
                          onClick={sendCharge}
                          className="text-sm font-medium py-2 rounded-card border border-ringo-border text-ringo-text w-fit px-4"
                        >
                          Try again
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>

          {createError && (
            <p className="text-sm text-red-500 flex items-center gap-1.5">
              <AlertTriangle size={14} />
              {createError}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={createAccount}
              disabled={!canCreate || creating}
              className="flex items-center gap-1.5 px-4 py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-50"
            >
              {creating && <Loader2 size={14} className="animate-spin" />}
              {creating ? "Creating…" : "Create account"}
            </button>

            {!showReject ? (
              <button
                onClick={() => setShowReject(true)}
                className="text-sm text-ringo-muted hover:text-red-500 transition-colors"
              >
                Reject this request
              </button>
            ) : null}
          </div>

          {showReject && (
            <div className="rounded-card border border-red-500/30 bg-red-500/5 p-4 flex flex-col gap-3">
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Reason (optional)"
                rows={2}
                className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-surface text-ringo-text resize-none"
              />
              <div className="flex gap-2">
                <button
                  onClick={reject}
                  disabled={rejecting}
                  className="text-xs font-medium px-3.5 py-2 rounded-card bg-red-500 text-white disabled:opacity-50"
                >
                  {rejecting ? "Rejecting…" : "Confirm reject"}
                </button>
                <button
                  onClick={() => setShowReject(false)}
                  className="text-xs font-medium px-3.5 py-2 rounded-card border border-ringo-border text-ringo-text"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {created && (
        <div className="rounded-card border border-ringo-teal/40 bg-ringo-teal/5 p-5 flex flex-col gap-3">
          <p className="text-sm font-medium text-ringo-text flex items-center gap-1.5">
            <Check size={15} className="text-ringo-teal" />
            Account created — share these with the customer:
          </p>
          <div className="flex flex-col gap-1.5 font-mono text-sm bg-ringo-surface rounded-card p-3 border border-ringo-border">
            <p>
              Page: ringoconnect.com/<strong>{created.username}</strong>
            </p>
            <p>
              Username: <strong>{created.username}</strong>
            </p>
            <p>
              Password: <strong>{password}</strong>
            </p>
          </div>
          <Link href="/admin/requests" className="text-sm text-ringo-indigo font-medium w-fit">
            Back to requests
          </Link>
        </div>
      )}
    </div>
  );
}