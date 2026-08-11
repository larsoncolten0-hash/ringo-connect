"use client";

import { useState } from "react";

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
          className={`w-full rounded-card border bg-ringo-surface px-3.5 py-2.5 text-sm text-ringo-text placeholder:text-ringo-muted/60 outline-none transition focus:ring-2 focus:ring-ringo-indigo/40 ${
            error ? "border-red-500" : "border-ringo-border focus:border-ringo-indigo"
          }`}
        />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-ringo-muted hover:text-ringo-text"
          >
            {showPassword ? "Hide" : "Show"}
          </button>
        )}
      </div>
      {error && <span className="block mt-1 text-xs text-red-500">{error}</span>}
    </label>
  );
}
