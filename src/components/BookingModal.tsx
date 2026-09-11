"use client";

import { useState } from "react";
import { X, Check, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getBookingConfig, type BookingFieldConfig } from "@/lib/categories";

// The actual booking surface — opened from BookingButton on any public
// profile that has bookings_enabled. A 2-step flow (form → confirmation),
// the same shape as RestaurantOrderPage's checkout→confirmation just
// without a cart step. POSTs to /api/bookings, which is the only thing
// that ever writes a real `bookings` row — nothing here is a confirmed
// booking, only a request (see the confirmation copy below).
//
// Colors are plain neutrals + the creator's own `accent`, not the ringo-*
// dashboard tokens — this renders over the creator's own themed public
// page, the same reasoning ShareButton.tsx and RestaurantOrderPage's
// checkout step already use.
export default function BookingModal({
  profile,
  accent,
  onClose,
}: {
  profile: any;
  accent: string;
  onClose: () => void;
}) {
  const { t, locale } = useLanguage();
  const config = getBookingConfig(profile.category);
  const services: any[] = (profile.booking_services || []).slice().sort((a: any, b: any) => a.sort_order - b.sort_order);
  const displayName = profile.name || profile.username;

  const [step, setStep] = useState<"form" | "confirmation">("form");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [honeypot, setHoneypot] = useState("");

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [message, setMessage] = useState("");
  const [consentEmail, setConsentEmail] = useState(false);
  const [consentWhatsapp, setConsentWhatsapp] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});

  const setField = (key: string, value: string) => setFieldValues((prev) => ({ ...prev, [key]: value }));

  const inputClass = "border rounded-card px-3.5 py-2.5 text-sm w-full";
  const inputStyle = { borderColor: "#E5E7EB" } as const;
  const labelClass = "text-xs font-medium mb-1.5 block";
  const labelStyle = { opacity: 0.7 } as const;

  const renderField = (field: BookingFieldConfig) => {
    const label = field.label[locale];
    const placeholder = field.placeholder?.[locale];
    const value = fieldValues[field.key] || "";

    if (field.key === "date") {
      return (
        <label key={field.key} className="flex flex-col">
          <span className={labelClass} style={labelStyle}>{label}</span>
          <input type="date" value={value} onChange={(e) => setField(field.key, e.target.value)} className={inputClass} style={inputStyle} />
        </label>
      );
    }
    if (field.key === "time") {
      return (
        <label key={field.key} className="flex flex-col">
          <span className={labelClass} style={labelStyle}>{label}</span>
          <input type="time" value={value} onChange={(e) => setField(field.key, e.target.value)} className={inputClass} style={inputStyle} />
        </label>
      );
    }
    if (field.key === "partySize") {
      return (
        <label key={field.key} className="flex flex-col">
          <span className={labelClass} style={labelStyle}>{label}</span>
          <input
            type="number"
            min={1}
            inputMode="numeric"
            value={value}
            onChange={(e) => setField(field.key, e.target.value.replace(/[^0-9]/g, ""))}
            className={inputClass}
            style={inputStyle}
          />
        </label>
      );
    }
    // location / budget / eventType / meetingType — plain text.
    return (
      <label key={field.key} className="flex flex-col">
        <span className={labelClass} style={labelStyle}>{label}</span>
        <input
          type="text"
          value={value}
          placeholder={placeholder}
          onChange={(e) => setField(field.key, e.target.value)}
          className={inputClass}
          style={inputStyle}
        />
      </label>
    );
  };

  const submit = async () => {
    setError("");
    if (!fullName.trim()) {
      setError(t.booking.nameRequired);
      return;
    }
    if (!phone.trim()) {
      setError(t.booking.phoneRequired);
      return;
    }

    setSubmitting(true);
    try {
      const details: Record<string, string> = {};
      if (fieldValues.eventType) details.event_type = fieldValues.eventType;
      if (fieldValues.meetingType) details.meeting_type = fieldValues.meetingType;

      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: profile.id,
          website: honeypot,
          customer_name: fullName.trim(),
          customer_email: email.trim(),
          customer_phone: phone.trim(),
          service_id: serviceId || null,
          booking_date: fieldValues.date || null,
          booking_time: fieldValues.time || null,
          party_size: fieldValues.partySize || null,
          location: fieldValues.location || null,
          budget: fieldValues.budget || null,
          details,
          notes: message.trim(),
          consent_email_updates: consentEmail,
          consent_whatsapp_updates: consentWhatsapp,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error || t.booking.submitFailed);
      }
      setStep("confirmation");
    } catch (err: any) {
      setError(err?.message || t.booking.submitFailed);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <div
        className="relative w-full sm:max-w-md max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-white p-5 sm:p-6"
        style={{ color: "#14202B" }}
      >
        <button
          onClick={onClose}
          aria-label={t.booking.close}
          className="absolute right-4 top-4 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ backgroundColor: "#F3F4F6", color: "#14202B" }}
        >
          <X size={16} />
        </button>

        {step === "form" ? (
          <div className="flex flex-col gap-4">
            <div className="pr-10">
              <h2 className="font-display text-lg font-bold">{t.booking.formTitle(displayName)}</h2>
              {profile.booking_description && (
                <p className="text-sm mt-1" style={{ opacity: 0.7 }}>
                  {profile.booking_description}
                </p>
              )}
            </div>

            {error && (
              <p className="text-sm px-3.5 py-2.5 rounded-card" style={{ backgroundColor: "#FEE2E2", color: "#991B1B" }}>
                {error}
              </p>
            )}

            <label className="flex flex-col">
              <span className={labelClass} style={labelStyle}>{t.booking.fullName}</span>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={t.booking.fullNamePlaceholder} className={inputClass} style={inputStyle} />
            </label>

            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col">
                <span className={labelClass} style={labelStyle}>{t.booking.email}</span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.booking.emailPlaceholder}
                  className={inputClass}
                  style={inputStyle}
                />
              </label>
              <label className="flex flex-col">
                <span className={labelClass} style={labelStyle}>{t.booking.phone}</span>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder={t.booking.phonePlaceholder}
                  className={inputClass}
                  style={inputStyle}
                />
              </label>
            </div>

            {services.length > 0 && (
              <label className="flex flex-col">
                <span className={labelClass} style={labelStyle}>{t.booking.service}</span>
                <select value={serviceId} onChange={(e) => setServiceId(e.target.value)} className={inputClass} style={inputStyle}>
                  <option value="">{t.booking.serviceNone}</option>
                  {services.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {config.fields.length > 0 && (
              <div className="grid grid-cols-2 gap-3">{config.fields.map(renderField)}</div>
            )}

            <label className="flex flex-col">
              <span className={labelClass} style={labelStyle}>{t.booking.message}</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t.booking.messagePlaceholder}
                rows={3}
                className={`${inputClass} resize-none`}
                style={inputStyle}
              />
            </label>

            {/* Honeypot — real visitors never see this; a filled value is
                silently discarded server-side. Not a form field a keyboard
                user could stumble into (off-screen, not just opacity:0). */}
            <input
              type="text"
              value={honeypot}
              onChange={(e) => setHoneypot(e.target.value)}
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="absolute -left-[9999px] w-px h-px"
            />

            <div className="rounded-2xl p-3.5 flex flex-col gap-2" style={{ backgroundColor: "#F9FAFB" }}>
              <p className="text-xs font-medium">{t.booking.stayConnected(displayName)}</p>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={consentEmail} onChange={(e) => setConsentEmail(e.target.checked)} style={{ accentColor: accent }} />
                {t.booking.consentEmail}
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer">
                <input type="checkbox" checked={consentWhatsapp} onChange={(e) => setConsentWhatsapp(e.target.checked)} style={{ accentColor: accent }} />
                {t.booking.consentWhatsapp}
              </label>
            </div>

            <button
              onClick={submit}
              disabled={submitting}
              className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-60"
              style={{ backgroundColor: accent }}
            >
              {submitting && <Loader2 size={15} className="animate-spin" />}
              {submitting ? t.booking.submitting : t.booking.submit}
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center text-center gap-3 py-4">
            <span className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accent}1a` }}>
              <Check size={28} style={{ color: accent }} />
            </span>
            <h2 className="font-display text-lg font-bold">{t.booking.successTitle}</h2>
            <p className="text-sm" style={{ opacity: 0.75 }}>
              {t.booking.successBody(displayName)}
            </p>
            <button
              onClick={onClose}
              className="mt-2 px-5 py-2.5 rounded-full text-sm font-semibold text-white"
              style={{ backgroundColor: accent }}
            >
              {t.booking.backToProfile}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
