"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

export default function ThemeToggle({
  iconOnly = false,
  variant = "default",
}: {
  iconOnly?: boolean;
  variant?: "default" | "onDark";
}) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    setIsDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggle = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("ringo-theme", next ? "dark" : "light");
  };

  if (iconOnly) {
    return (
      <button
        onClick={toggle}
        aria-label="Toggle dark mode"
        className={`w-9 h-9 flex items-center justify-center rounded-full transition ${
          variant === "onDark"
            ? "text-white/50 hover:text-white hover:bg-white/10"
            : "text-ringo-muted hover:text-ringo-text hover:bg-ringo-muted/10"
        }`}
      >
        {isDark ? <Sun size={17} /> : <Moon size={17} />}
      </button>
    );
  }

  return (
    <button
      onClick={toggle}
      aria-label="Toggle dark mode"
      className="text-xs px-3 py-1.5 rounded-card border border-ringo-border text-ringo-text"
    >
      {isDark ? "Light mode" : "Dark mode"}
    </button>
  );
}