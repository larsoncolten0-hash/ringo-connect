"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ChurchCapabilities } from "@/lib/church/permissions";
import PersonPicker, { type PickedPerson } from "./PersonPicker";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorLine, Field, INPUT, Modal, churchApi, errorText } from "./shared";

export interface MemberRecord {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  preferred_language: "en" | "fr" | null;
  status: "pending" | "active" | "inactive" | "removed";
  age_group: "adult" | "youth" | "child";
  guardian_member_id: string | null;
}

// Create or edit one person. Children are handled with care: a child's record holds a name, an age group and a guardian only (the form hides, and the server refuses, contact details),
// and a user without permission to manage children cannot pick the Child age group. The server and the database decide what is allowed; this form only avoids offering what would be refused.
export default function MemberFormDialog({
  mode,
  member,
  guardian,
  caps,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  member?: MemberRecord;
  guardian?: PickedPerson | null;
  caps: ChurchCapabilities;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { t } = useLanguage();
  const c = t.churchPeople;
  const f = c.people.form;
  const [fullName, setFullName] = useState(member?.full_name ?? "");
  const [phone, setPhone] = useState(member?.phone ?? "");
  const [email, setEmail] = useState(member?.email ?? "");
  const [language, setLanguage] = useState<string>(member?.preferred_language ?? "");
  const [status, setStatus] = useState<MemberRecord["status"]>(member?.status ?? "active");
  const [age, setAge] = useState<MemberRecord["age_group"]>(member?.age_group ?? "adult");
  const [guardianPick, setGuardianPick] = useState<PickedPerson | null>(guardian ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [field, setField] = useState<string | undefined>();

  const isChild = age === "child";
  const canChooseChild = caps.manageChildren;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setField(undefined);
    if (isChild && !guardianPick) {
      setField("guardian_member_id");
      setError(c.errors.child_needs_guardian);
      return;
    }
    // Build the body. A child's contact details are never sent. On edit only the fields that changed are sent.
    const next: Record<string, unknown> = {
      full_name: fullName,
      phone: isChild ? null : phone.trim() === "" ? null : phone,
      email: isChild ? null : email.trim() === "" ? null : email,
      preferred_language: language === "" ? null : language,
      status,
      age_group: age,
      guardian_member_id: age === "adult" ? null : guardianPick?.id ?? null,
    };
    let body: Record<string, unknown> = next;
    if (mode === "edit" && member) {
      const before: Record<string, unknown> = {
        full_name: member.full_name,
        phone: member.phone,
        email: member.email,
        preferred_language: member.preferred_language,
        status: member.status,
        age_group: member.age_group,
        guardian_member_id: member.guardian_member_id,
      };
      body = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== before[k]));
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
    } else {
      // on create, leave out what is empty or implied
      body = Object.fromEntries(Object.entries(next).filter(([k, v]) => !(v === null && (k === "phone" || k === "email" || k === "preferred_language" || k === "guardian_member_id"))));
    }
    setBusy(true);
    const r = await churchApi(mode === "create" ? "/api/church/members" : `/api/church/members/${member!.id}`, { method: mode === "create" ? "POST" : "PATCH", body });
    setBusy(false);
    if (!r.ok) {
      setField(r.field);
      setError(errorText(c.errors, r.code));
      return;
    }
    onSaved(mode === "create" ? f.created : f.updated);
  };

  return (
    <Modal title={mode === "create" ? f.createTitle : f.editTitle} subtitle={mode === "create" ? f.createLead : undefined} onClose={onClose} wide labelledBy="church-member-form-title">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field id="cm-name" label={f.fullName}>
          <input id="cm-name" className={INPUT} value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} required autoComplete="off" placeholder={f.namePlaceholder} aria-invalid={field === "full_name"} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="cm-age" label={f.ageGroup}>
            <select
              id="cm-age"
              className={INPUT}
              value={age}
              onChange={(e) => setAge(e.target.value as MemberRecord["age_group"])}
              aria-describedby={!canChooseChild ? "cm-age-hint" : undefined}
            >
              <option value="adult">{c.age.adult}</option>
              <option value="youth">{c.age.youth}</option>
              <option value="child" disabled={!canChooseChild && age !== "child"}>
                {c.age.child}
              </option>
            </select>
            {!canChooseChild && (
              <p id="cm-age-hint" className="text-xs text-ringo-muted">
                {f.childNeedsPermission}
              </p>
            )}
          </Field>
          <Field id="cm-status" label={f.status}>
            <select id="cm-status" className={INPUT} value={status} onChange={(e) => setStatus(e.target.value as MemberRecord["status"])}>
              <option value="pending">{c.status.pending}</option>
              <option value="active">{c.status.active}</option>
              <option value="inactive">{c.status.inactive}</option>
              {(mode === "edit" || status === "removed") && <option value="removed">{c.status.removed}</option>}
            </select>
          </Field>
        </div>

        {age !== "adult" && (
          <Field id="cm-guardian" label={f.guardian} hint={isChild ? f.guardianHelp : undefined} optional={!isChild}>
            <PersonPicker label={f.guardianSearchLabel} placeholder={f.guardianPlaceholder} noneText={f.guardianNone} clearLabel={f.guardianClear} value={guardianPick} onChange={setGuardianPick} ageGroup="adult" describedBy={isChild ? "cm-guardian-hint" : undefined} />
          </Field>
        )}

        {isChild ? (
          <p className="rounded-2xl bg-ringo-indigo/[0.06] px-4 py-3 text-xs leading-relaxed text-ringo-indigo">{f.childHelp}</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="cm-phone" label={f.phone} optional>
              <input id="cm-phone" className={INPUT} type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} autoComplete="off" aria-invalid={field === "phone"} />
            </Field>
            <Field id="cm-email" label={f.email} optional>
              <input id="cm-email" className={INPUT} type="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} autoComplete="off" aria-invalid={field === "email"} />
            </Field>
          </div>
        )}

        <Field id="cm-lang" label={f.language} optional>
          <select id="cm-lang" className={INPUT} value={language} onChange={(e) => setLanguage(e.target.value)}>
            <option value="">{c.common.notSet}</option>
            <option value="en">{c.language.en}</option>
            <option value="fr">{c.language.fr}</option>
          </select>
        </Field>

        <ErrorLine message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>
            {c.common.cancel}
          </button>
          <button type="submit" disabled={busy || fullName.trim() === ""} className={BTN_PRIMARY}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {busy ? c.common.saving : mode === "create" ? f.create : c.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
