"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { UserPlus, Link2, Copy, Check, Loader2, MessageCircle } from "lucide-react";
import TeamModal from "@/components/team/TeamModal";

interface RoleOption {
  id: string;
  name: string;
}

// The two invitation methods the product spec requires as clearly
// distinct choices, not two fields on one form: "Enter details" (the
// manager types the person's name/contact and Ringo notifies them, or
// hands the manager a link to pass along if there's no email) vs. "Invite
// with link" (a role-scoped link with nothing pre-filled, for the manager
// to share however they like — WhatsApp, SMS, in person). Both call the
// exact same POST /api/team/invitations underneath; they only differ in
// `method` and which fields are collected first.
export default function AddTeamMemberModal({
  profileId,
  organizationName,
  onClose,
  onCreated,
}: {
  profileId: string;
  organizationName: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<"choose" | "manual" | "link" | "result">("choose");
  const [roles, setRoles] = useState<RoleOption[]>([]);
  const [roleId, setRoleId] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ inviteUrl: string; roleName: string; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch(`/api/team/roles?profileId=${profileId}`)
      .then((r) => r.json())
      .then((data) => {
        setRoles(data.roles || []);
        if (data.roles?.[0]) setRoleId(data.roles[0].id);
      })
      .catch(() => {});
  }, [profileId]);

  const submit = async (method: "manual" | "link") => {
    setError("");
    if (!roleId) {
      setError("Choose a role first.");
      return;
    }
    if (method === "manual" && !name.trim()) {
      setError("Enter their name.");
      return;
    }
    if (method === "manual" && !email.trim() && !phone.trim()) {
      setError("Provide at least an email or a phone number.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          roleId,
          method,
          inviteeName: method === "manual" ? name.trim() : undefined,
          inviteeEmail: method === "manual" ? email.trim() || undefined : undefined,
          inviteePhone: method === "manual" ? phone.trim() || undefined : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Something went wrong.");

      setResult({ inviteUrl: data.inviteUrl, roleName: roles.find((r) => r.id === roleId)?.name || "", emailSent: data.emailSent });
      setStep("result");
      onCreated();
    } catch (err: any) {
      setError(err?.message || "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  };

  const copyLink = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(result.inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  const whatsappHref = result
    ? `https://wa.me/?text=${encodeURIComponent(
        `You've been invited to join ${organizationName} on Ringo Connect as a ${result.roleName}.\n\nJoin here:\n${result.inviteUrl}`
      )}`
    : "#";

  return (
    <TeamModal
      title={step === "result" ? "Invitation created" : "Add Team Member"}
      subtitle={step === "choose" ? "How would you like to add them?" : undefined}
      onClose={onClose}
    >
      {step === "choose" && (
        <div className="flex flex-col gap-2.5">
          <ChoiceCard icon={UserPlus} title="Enter details" subtitle="Add their name, phone, or email — Ringo notifies them." onClick={() => setStep("manual")} />
          <ChoiceCard icon={Link2} title="Invite with link" subtitle="Get a secure link, share it however you like." onClick={() => setStep("link")} />
        </div>
      )}

      {(step === "manual" || step === "link") && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit(step);
          }}
          className="flex flex-col gap-3"
        >
          <Field label="Role">
            <select
              value={roleId}
              onChange={(e) => setRoleId(e.target.value)}
              className="w-full text-sm border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text"
            >
              {roles.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </Field>

          {step === "manual" && (
            <>
              <Field label="Full name">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Jean Mbarga"
                  className="w-full text-sm border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text"
                />
              </Field>
              <Field label="Phone (optional)">
                <input
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+237 ..."
                  className="w-full text-sm border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text"
                />
              </Field>
              <Field label="Email (optional)">
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="jean@example.com"
                  className="w-full text-sm border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-text"
                />
              </Field>
              <p className="text-xs text-ringo-muted -mt-1">Provide at least a phone or an email. They'll set up their own Ringo account and password.</p>
            </>
          )}

          {step === "link" && <p className="text-xs text-ringo-muted -mt-1">Invitation expires in 7 days. You can revoke it anytime before it's accepted.</p>}

          {error && <p className="text-xs text-ringo-coral">{error}</p>}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={() => setStep("choose")}
              className="flex-1 py-2.5 rounded-full text-sm font-semibold border border-ringo-border text-ringo-text hover:bg-ringo-muted/10 transition"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-[2] flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-semibold bg-ringo-indigo text-white hover:brightness-110 active:scale-[0.98] transition disabled:opacity-70"
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {step === "manual" ? "Send Invitation" : "Generate Link"}
            </button>
          </div>
        </form>
      )}

      {step === "result" && result && (
        <div className="flex flex-col gap-3">
          <div className="rounded-2xl border border-ringo-border/70 p-3.5 flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-ringo-muted">{organizationName}</span>
            <span className="text-sm font-medium text-ringo-text">{result.roleName}</span>
          </div>

          {result.emailSent && <p className="text-xs text-ringo-teal">An invitation email was sent.</p>}

          <Field label="Invitation link">
            <div className="flex items-center gap-2">
              <input readOnly value={result.inviteUrl} className="flex-1 text-xs border border-ringo-border rounded-card px-3 py-2.5 bg-ringo-bg text-ringo-muted truncate" />
              <button
                type="button"
                onClick={copyLink}
                aria-label="Copy link"
                className="w-10 h-10 shrink-0 rounded-full flex items-center justify-center border border-ringo-border text-ringo-text hover:bg-ringo-muted/10 transition"
              >
                {copied ? <Check size={15} className="text-ringo-teal" /> : <Copy size={15} />}
              </button>
            </div>
          </Field>

          <a
            href={whatsappHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 py-2.5 rounded-full text-sm font-semibold bg-[#25D366] text-white hover:brightness-105 active:scale-[0.98] transition"
          >
            <MessageCircle size={15} />
            Share via WhatsApp
          </a>

          <button
            type="button"
            onClick={onClose}
            className="py-2.5 rounded-full text-sm font-semibold border border-ringo-border text-ringo-text hover:bg-ringo-muted/10 transition"
          >
            Done
          </button>
        </div>
      )}
    </TeamModal>
  );
}

function ChoiceCard({ icon: Icon, title, subtitle, onClick }: { icon: any; title: string; subtitle: string; onClick: () => void }) {
  return (
    <motion.button
      whileTap={{ scale: 0.98 }}
      onClick={onClick}
      className="flex items-start gap-3 text-left p-4 rounded-2xl border border-ringo-border/70 hover:border-ringo-indigo/40 hover:bg-ringo-indigo/[0.03] transition"
    >
      <span className="w-9 h-9 rounded-xl bg-ringo-indigo/10 flex items-center justify-center text-ringo-indigo shrink-0">
        <Icon size={17} />
      </span>
      <span>
        <span className="block text-sm font-semibold text-ringo-text">{title}</span>
        <span className="block text-xs text-ringo-muted mt-0.5">{subtitle}</span>
      </span>
    </motion.button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-ringo-muted">{label}</span>
      {children}
    </label>
  );
}
