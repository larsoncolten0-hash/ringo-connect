"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

export default function FormField({
  label,
  type = "text",
  value,
  onChange,
  error,
  autoComplete,
  placeholder,
  required = true,
}: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  error?: string;
  autoComplete?: string;
  placeholder?: string;
  required?: boolean;
}) {
  const { t } = useLanguage();
  // Only the DISPLAY of the typed text changes (the field's type): the value, validation, autocomplete hints and the submit are exactly the same, and nothing is stored or sent
  // anywhere because of the toggle. It is a plain button (type="button", so it never submits the form) that is a normal tab stop and a 44px touch target.
  const [showPassword, setShowPassword] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && showPassword ? "text" : type;

  return (
    <label className="block mb-4">
      <span className="text-sm font-medium text-ringo-text">{label}</span>
      <div className="relative mt-1.5">
        <input
          type={inputType}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          autoComplete={autoComplete}
          placeholder={placeholder}
          aria-invalid={!!error}
          className={`w-full rounded-card border bg-ringo-surface px-3.5 py-2.5 text-sm text-ringo-text placeholder:text-ringo-muted/60 outline-none transition focus:ring-2 focus:ring-ringo-indigo/40 ${isPassword ? "pr-12" : ""} ${
            error ? "border-red-500" : "border-ringo-border focus:border-ringo-indigo"
          }`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? t.passwordField.hide : t.passwordField.show}
            title={showPassword ? t.passwordField.hide : t.passwordField.show}
            className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-card text-ringo-muted transition hover:text-ringo-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ringo-indigo"
          >
            {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        )}
      </div>
      {error && <span className="block mt-1 text-xs text-red-500">{error}</span>}
    </label>
  );
}
