// The Privacy Policy and the Terms of Service are plain structured content in both languages (src/lib/legal/*.en.ts / *.fr.ts), rendered by components/legal/LegalDocument.tsx.
// Inline **bold** is supported; an e-mail address is turned into a mailto link.
export type LegalBlock =
  | { p: string }
  | { ul: string[] }
  // A statement Ringo's owner has to confirm before it can be treated as final (a legal or business fact the code cannot establish). Shown as a clearly marked note, never silently invented.
  | { review: string };

export type LegalSection = { id: string; title: string; blocks: LegalBlock[] };

export type LegalDoc = {
  title: string;
  /** Short description for the page's metadata and sharing previews. */
  description: string;
  updated: string;
  intro: string[];
  sections: LegalSection[];
};

export const LEGAL_CONTACT_EMAIL = "info@ringoconnectltd.com";
