// The one place that knows every language. Server code (emails, PDFs, notifications, crons) and the tests import from here and get both dictionaries, exactly as before.
// The dictionaries themselves live in translations.en.ts and translations.fr.ts so that the BROWSER can load just the language it needs (see components/LanguageProvider.tsx).
import { en } from "./translations.en";
import { fr } from "./translations.fr";

export type Locale = "en" | "fr";

export const translations = { en, fr } satisfies Record<Locale, any>;

export type Translations = typeof en;
