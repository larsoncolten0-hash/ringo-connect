import { Big_Shoulders_Display } from "next/font/google";

// Poster-style display face for the artist's name and titles. Loaded once, only by the Music profile and its destination pages (nothing else imports this module).
export const display = Big_Shoulders_Display({ subsets: ["latin", "latin-ext"], weight: ["800", "900"], variable: "--font-mp-display", display: "swap" });
