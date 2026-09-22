import type { CategoryId } from "@/lib/categories";

// A unit of Ringo knowledge. Model-facing only (written in English; Ringo AI
// answers in the user's language and quotes real UI labels from
// navigation.ts, which reads translations.ts for both EN and FR).
//
// Adding knowledge for a new feature (e.g. "loyalty.advanced"):
//   1. create modules/<name>.ts exporting a KnowledgeModule
//   2. add it to KNOWLEDGE_MODULES in ./index.ts
// Diagnostics (../diagnostics/checks.ts) and tools (../tools/definitions)
// reference modules by `id`, so the three stay linked without coupling.
//
// Facts that change at runtime (plan limits, prices) must NOT be written
// into `body` — use `live` to render them from the database instead.

export interface KnowledgeModule {
  id: string;
  /** Bump when the content meaningfully changes (logged with answers later). */
  version: number;
  title: string;
  /** One line, shown in the catalog so the model knows when to look it up. */
  summary: string;
  appliesTo: {
    /** Always in the (cached) base prompt. Keep these few and short. */
    always?: boolean;
    /** Loaded into the prompt automatically for profiles with these categories. */
    categories?: CategoryId[];
  };
  body: string;
  related?: string[];
  /** Optional live facts appended when the module is looked up. */
  live?: () => Promise<string>;
}
