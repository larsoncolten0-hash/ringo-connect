"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import PersonPicker, { type PickedPerson } from "./PersonPicker";
import { BTN_PRIMARY, BTN_SECONDARY, ErrorLine, Field, INPUT, Modal, churchApi, errorText } from "./shared";

export interface Appointment {
  id: string;
  member_id: string;
  name: string | null;
  title: string;
  started_on: string | null;
  ended_on: string | null;
  is_current: boolean;
}

// Create or edit a leadership appointment (a titled role with optional start and end dates). The person is fixed once an appointment exists: to change them, end it and create a new one.
export default function AppointmentFormDialog({ mode, appointment, onClose, onSaved }: { mode: "create" | "edit"; appointment?: Appointment; onClose: () => void; onSaved: (message: string) => void }) {
  const { t } = useLanguage();
  const c = t.churchPeople;
  const f = c.leadership.form;
  const [person, setPerson] = useState<PickedPerson | null>(null);
  const [title, setTitle] = useState(appointment?.title ?? "");
  const [startedOn, setStartedOn] = useState(appointment?.started_on ?? "");
  const [endedOn, setEndedOn] = useState(appointment?.ended_on ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (startedOn && endedOn && endedOn < startedOn) {
      setError(c.errors.invalid_date_range);
      return;
    }
    let body: Record<string, unknown>;
    if (mode === "create") {
      if (!person) {
        setError(c.errors.invalid_member_id);
        return;
      }
      body = { member_id: person.id, title, started_on: startedOn || null, ended_on: endedOn || null };
    } else {
      body = {};
      if (title !== appointment!.title) body.title = title;
      if ((startedOn || null) !== appointment!.started_on) body.started_on = startedOn || null;
      if ((endedOn || null) !== appointment!.ended_on) body.ended_on = endedOn || null;
      if (Object.keys(body).length === 0) {
        onClose();
        return;
      }
    }
    setBusy(true);
    const r = await churchApi(mode === "create" ? "/api/church/leadership" : `/api/church/leadership/${appointment!.id}`, { method: mode === "create" ? "POST" : "PATCH", body });
    setBusy(false);
    if (!r.ok) {
      setError(errorText(c.errors, r.code));
      return;
    }
    onSaved(mode === "create" ? f.created : f.updated);
  };

  return (
    <Modal title={mode === "create" ? f.createTitle : f.editTitle} onClose={onClose} labelledBy="church-appointment-form-title">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        {mode === "create" ? (
          <Field id="ca-person" label={f.person}>
            <PersonPicker label={f.person} placeholder={f.personPlaceholder} noneText={f.personNone} clearLabel={c.common.cancel} value={person} onChange={setPerson} ageGroup="adult" />
          </Field>
        ) : (
          <div>
            <p className="text-xs font-semibold text-ringo-text">{f.person}</p>
            <p className="mt-1 text-sm text-ringo-text">{appointment!.name ?? c.common.unnamed}</p>
            <p className="mt-1 text-xs text-ringo-muted">{f.personFixed}</p>
          </div>
        )}
        <Field id="ca-title" label={f.title}>
          <input id="ca-title" className={INPUT} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} required autoComplete="off" placeholder={f.titlePlaceholder} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ca-start" label={f.startedOn} optional>
            <input id="ca-start" type="date" className={INPUT} value={startedOn} onChange={(e) => setStartedOn(e.target.value)} min="1900-01-01" max="2100-12-31" />
          </Field>
          <Field id="ca-end" label={f.endedOn} hint={f.endedHelp} optional>
            <input id="ca-end" type="date" className={INPUT} value={endedOn} onChange={(e) => setEndedOn(e.target.value)} min={startedOn || "1900-01-01"} max="2100-12-31" aria-describedby="ca-end-hint" />
          </Field>
        </div>
        <ErrorLine message={error} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className={BTN_SECONDARY}>
            {c.common.cancel}
          </button>
          <button type="submit" disabled={busy || title.trim() === ""} className={BTN_PRIMARY}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden="true" />}
            {busy ? c.common.saving : mode === "create" ? f.create : c.common.save}
          </button>
        </div>
      </form>
    </Modal>
  );
}
