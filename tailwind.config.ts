import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{ts,tsx}",
    "./src/components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "sans-serif"],
        sans: ["var(--font-body)", "sans-serif"],
        // Technical micro-language (status, data). A new key: the existing `font-mono` utility is untouched.
        micro: ["var(--ringo-font-mono)"],
      },
      colors: {
        ringo: {
          // Sourced from the --ringo-indigo CSS variable (globals.css,
          // R G B channel numbers, not a hex string — see its own
          // comment on why), overridden per-request from
          // branding_settings.primary_color. The `rgb(... / <alpha-value>)`
          // form (a documented Tailwind pattern for dynamic colors) is
          // what keeps `bg-ringo-indigo/10`-style opacity modifiers
          // working — a plain `var(--ringo-indigo)` string would silently
          // break every one of them.
          indigo: "rgb(var(--ringo-indigo) / <alpha-value>)",
          coral: "#FF6B4A",
          teal: "#14B8A6",
          bg: "var(--ringo-bg)",
          surface: "var(--ringo-surface)",
          text: "var(--ringo-text)",
          muted: "var(--ringo-muted)",
          border: "var(--ringo-border)",
          navy: "var(--ringo-text)",
          slate: "var(--ringo-muted)",
          white: "var(--ringo-surface)",

          // ---- Design foundation (globals.css, "RINGO DESIGN FOUNDATION"). All new keys; none of the above changed. ----
          // Primitives. Channel triplets, so bg-ringo-gold/20 works.
          ink: "rgb(var(--rc-ink) / <alpha-value>)",
          "ink-2": "rgb(var(--rc-ink-2) / <alpha-value>)",
          paper: "rgb(var(--rc-paper) / <alpha-value>)",
          gold: "rgb(var(--rc-gold) / <alpha-value>)",
          "gold-dark": "rgb(var(--rc-gold-dark) / <alpha-value>)",
          "gold-light": "rgb(var(--rc-gold-light) / <alpha-value>)",
          "gold-display": "rgb(var(--ringo-gold-display) / <alpha-value>)",
          ember: "rgb(var(--rc-ember) / <alpha-value>)",
          "ember-dark": "rgb(var(--rc-ember-dark) / <alpha-value>)",
          signal: "rgb(var(--rc-signal) / <alpha-value>)",
          "signal-dark": "rgb(var(--rc-signal-dark) / <alpha-value>)",
          rose: "rgb(var(--rc-rose) / <alpha-value>)",
          "rose-dark": "rgb(var(--rc-rose-dark) / <alpha-value>)",
          stone: {
            50: "rgb(var(--rc-stone-50) / <alpha-value>)",
            100: "rgb(var(--rc-stone-100) / <alpha-value>)",
            200: "rgb(var(--rc-stone-200) / <alpha-value>)",
            300: "rgb(var(--rc-stone-300) / <alpha-value>)",
            500: "rgb(var(--rc-stone-500) / <alpha-value>)",
            600: "rgb(var(--rc-stone-600) / <alpha-value>)",
            700: "rgb(var(--rc-stone-700) / <alpha-value>)",
            900: "rgb(var(--rc-stone-900) / <alpha-value>)",
          },
          // Semantic. `accent` is the compatibility layer: it follows --ringo-indigo today (and the admin's brand color),
          // and is re-pointed to gold in one line of CSS later. `*-text` flip with the theme to stay readable as text.
          accent: "rgb(var(--ringo-accent) / <alpha-value>)",
          "on-accent": "rgb(var(--ringo-on-accent) / <alpha-value>)",
          "gold-text": "rgb(var(--ringo-gold-text) / <alpha-value>)",
          "ember-text": "rgb(var(--ringo-ember-text) / <alpha-value>)",
          "signal-text": "rgb(var(--ringo-signal-text) / <alpha-value>)",
          "rose-text": "rgb(var(--ringo-rose-text) / <alpha-value>)",
          // Borders: neutral is the existing `border-ringo-border`; these are the warm and gilt kinds.
          "line-warm": "var(--ringo-line-warm)",
          "line-gilt": "var(--ringo-line-gilt)",
        },
      },
      // Radius scale 8 / 14 / 22 / 32 / pill (`rounded-full`). `card` (12px) stays for the screens that already use it.
      borderRadius: {
        card: "12px",
        "ringo-sm": "var(--ringo-radius-sm)",
        "ringo-md": "var(--ringo-radius-md)",
        "ringo-lg": "var(--ringo-radius-lg)",
        "ringo-xl": "var(--ringo-radius-xl)",
      },
      // Spacing 4 8 12 16 24 32 48 72 112 = Tailwind 1 2 3 4 6 8 12 18 28. Only 18 (72px) was missing from the default scale.
      spacing: {
        18: "4.5rem",
      },
      boxShadow: {
        "ringo-1": "var(--ringo-shadow-1)",
        "ringo-2": "var(--ringo-shadow-2)",
        "ringo-3": "var(--ringo-shadow-3)",
        "ringo-glow": "var(--ringo-glow-warm)",
        "ringo-signal": "var(--ringo-glow-signal)",
      },
      transitionDuration: {
        "ringo-fast": "var(--ringo-dur-fast)",
        "ringo-base": "var(--ringo-dur-base)",
        "ringo-slow": "var(--ringo-dur-slow)",
      },
      transitionTimingFunction: {
        ringo: "var(--ringo-ease)",
      },
      keyframes: {
        "ring-pulse": {
          "0%": { transform: "scale(0.4)", opacity: "0.9" },
          "100%": { transform: "scale(1)", opacity: "0" },
        },
        orbit: {
          "0%": { transform: "rotate(0deg) translateX(90px) rotate(0deg)" },
          "100%": { transform: "rotate(360deg) translateX(90px) rotate(-360deg)" },
        },
        "dropdown-in": {
          "0%": { opacity: "0", transform: "translateY(-4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        // Used throughout ProfileView.tsx (each element sets its own
        // animation-delay inline to stagger the entrance) — added here
        // because "animate-fade-up" had no matching keyframes/animation
        // entry at all, so it was silently a no-op utility class.
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "eq-bar": {
          "0%, 100%": { height: "4px" },
          "50%": { height: "12px" },
        },
        // The landing page's floating capability badges around the hero
        // phone mockup (see LandingView.tsx) — a gentle bob, nothing more.
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-8px)" },
        },
        // Generic entrance for content that swaps in all at once — e.g.
        // a loading.tsx skeleton, so it doesn't just snap into view.
        "fade-in": {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
      },
      animation: {
        "ring-pulse-1": "ring-pulse 3.2s ease-out infinite",
        "ring-pulse-2": "ring-pulse 3.2s ease-out 1.1s infinite",
        "ring-pulse-3": "ring-pulse 3.2s ease-out 2.2s infinite",
        orbit: "orbit 14s linear infinite",
        "dropdown-in": "dropdown-in 150ms ease-out",
        "fade-up": "fade-up 0.6s ease-out both",
        "eq-bar": "eq-bar 0.9s ease-in-out infinite",
        float: "float 5s ease-in-out infinite",
        "fade-in": "fade-in 0.3s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;