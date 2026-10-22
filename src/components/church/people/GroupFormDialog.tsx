"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorLine, Field, INPUT, Modal, churchApi, errorText } from "./shared";

export interface GroupRecord {
  id: string;
  kind: "department" | "group";
  name: string;
  description: string | null;
  status: "active" | "archived";
}

// Create or rename a group / department. The type (department or group) is chosen once, when the group is created.
export default function GroupFormDialog({ mode, group, onClose, onSaved }: { mode: "create" | "edit"; group?: GroupRecord; onClose: () => void; onSaved: (message: string) => void }) {
  const { t } = useLanguage();
  const c = t.churchPeople;
  const f = c.groups.form;
  const [kind, setKind] = useState<GroupRecord["kind"]>(group?.kind ?? "group");
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    let body: Record<string, unknown>;
    if (mode === "create") {
      body = { kind, name, description: description.trim() === "" ? null : description };
    } else {
      body = {};
      if (name !== group!.name) body.name = name;
      if ((description.trim() === "" ? null : description) !== group!.description) body.description = description.trim() === "" ? null : description;
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
    }
    setBusy(true);
    const r = await churchApi(mode === "create" ? "/api/church/groups" : `/api/church/groups/${group!.id}`, { method: mode === "create" ? "POST" : "PATCH", body });
    setBusy(false);
    if (!r.ok) {
      setError(errorText(c.errors, r.code));
      return;
    }
    onSaved(mode === "create" ? f.created : f.updated);
  };

  return (
    <Modal title={mode === "create" ? f.createTitle : f.editTitle} onClose={onClose} labelledBy="church-group-form-title">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {mode === "create" && (
          <Field id="cg-kind" label={f.kind}>
            <select id="cg-kind" className={INPUT} value={kind} onChange={(e) => setKind(e.target.value as GroupRecord["kind"])}>
              <option value="department">{c.kinds.department}</option>
              <option value="group">{c.kinds.group}</option>
            </select>
          </Field>
        )}
        <Field id="cg-name" label={f.name}>
          <input id="cg-name" className={INPUT} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required autoComplete="off" placeholder={f.namePlaceholder} />
        </Field>
        <Field id="cg-desc" label={f.description} optional>
          <textarea id="cg-desc" className={`${INPUT} min-h-[88px] resize-y`} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder={f.descriptionPlaceholder} />
        </Field>
        <ErrorLine message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>
            {c.common.cancel}
          </button>
          <button type="submit" disabled={busy || name.trim() === ""} className={BTN_PRIMARY}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {busy ? c.common.saving : mode === "create" ? f.create : c.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
