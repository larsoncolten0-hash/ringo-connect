import type { CategoryId } from "@/lib/categories";

// A unit of Ringo knowledge. Model-facing only (written in English; Ringo AI
// answers in the user's language and quotes real UI labels from
// navigation.ts, which reads translations.ts for both EN and FR).
//
// STANDING RULE for every future Ringo feature (see the ringo-ai-feature-coverage
// convention): when a feature is implemented or changed, the SAME change should keep
// Ringo AI current — never a separate later task. Concretely, ask "does this introduce or
// change something Ringo AI needs to understand?", and if yes:
//   1. create/update modules/<name>.ts exporting a KnowledgeModule and list it in
//      KNOWLEDGE_MODULES (./index.ts) — nothing else in Ringo AI changes to pick it up.
//   2. add a diagnostic in ../diagnostics/checks.ts ONLY for a rule the app actually
//      enforces right now (never a roadmap rule) — it references this module by `id`.
//   3. add a read tool (../tools/definitions/*.ts, registered in ../tools/index.ts, plus a
//      `t.ringoAi.toolStatus` label in both EN and FR) when the model would otherwise have
//      no way to see the user's own data for this feature.
//   4. run `npm run validate:ai-knowledge` (scripts/tests/ringo_ai_knowledge.test.mjs, which
//      calls validate.ts's validateKnowledgeModules/validateDiagnosticReferences against the
//      real registry) — it catches duplicate ids, invalid `status`, broken `related`/diagnostic
//      references, and obvious secret-shaped text before it ever reaches a module.
// Diagnostics and tools reference modules by `id`, so the three stay linked without coupling.
//
// Facts that change at runtime (plan limits, prices, live toggles) must NOT be written into
// `body` — use `live` to render them from the database instead.
//
// `status` is asserted by whoever registers the module, from the ACTUAL current app behavior —
// never from a table/column merely existing, and never from a roadmap idea. Only mark `"live"`
// once a user can actually do the thing today.

export type KnowledgeStatus = "live" | "partial" | "planned" | "unavailable";

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
  /**
   * Whether this capability is actually usable today. Optional and additive — existing modules
   * that predate this field are implicitly current/live by virtue of already shipping; new or
   * partially-built capabilities should set it explicitly rather than leaving it to `body` prose.
   */
  status?: KnowledgeStatus;
  /** Who this capability is for (e.g. "Any non-music seller with commerce enabled"). */
  whoCanUse?: string;
  /** Concrete user-facing actions this capability supports, in plain language. */
  actions?: string[];
  /** What must already be true/set up before this capability works. */
  prerequisites?: string[];
  /** Known gaps or things this capability deliberately does NOT do yet. */
  limitations?: string[];
}
