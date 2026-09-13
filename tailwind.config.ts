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
      },
      colors: {
        ringo: {
          indigo: "#4F46E5",
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
        },
      },
      borderRadius: {
        card: "12px",
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