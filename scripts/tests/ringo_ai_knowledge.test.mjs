// Validates the Ringo AI platform-knowledge registry (src/lib/ai/knowledge/**) against
// src/lib/ai/knowledge/validate.ts's own rules: duplicate module ids, invalid `status`, malformed
// modules (missing id/version/title/summary/body/appliesTo), broken `related` references, broken
// diagnostic -> knowledge references, and secret-shaped text. This is a structural/registration
// check, not feature-status inference: it never scans routes, tables, UI files or git diffs to
// guess whether a module's claimed status is true — see validate.ts's own header for why that's
// deliberate.
//
// Loads the real TypeScript modules through jiti (already present in node_modules as a
// transitive dependency — nothing added to package.json), same pattern as
// scripts/tests/ringo_ai_unit.test.mjs.
//
//   Run:  node scripts/tests/ringo_ai_knowledge.test.mjs
//   Or:   npm run validate:ai-knowledge
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const REPO = fileURLToPath(new URL("../../", import.meta.url));
const jiti = require("jiti")(import.meta.url, { alias: { "@": path.join(REPO, "src") }, interopDefault: true });
const load = (p) => jiti(path.join(REPO, "src", p));

const { validateKnowledgeModules, validateDiagnosticReferences } = load("lib/ai/knowledge/validate.ts");
const { KNOWLEDGE_MODULES } = load("lib/ai/knowledge/index.ts");
const { DIAGNOSTIC_CHECKS } = load("lib/ai/diagnostics/checks.ts");

const moduleErrors = validateKnowledgeModules(KNOWLEDGE_MODULES);
const diagnosticErrors = validateDiagnosticReferences(DIAGNOSTIC_CHECKS, KNOWLEDGE_MODULES);
const errors = [...moduleErrors, ...diagnosticErrors];

console.log(`Ringo AI knowledge: ${KNOWLEDGE_MODULES.length} modules, ${DIAGNOSTIC_CHECKS.length} diagnostics checked.`);

if (errors.length > 0) {
  console.log(`FAIL: ${errors.length} issue(s) found:`);
  for (const e of errors) console.log("  -", e);
  process.exit(1);
}

console.log("PASS: knowledge registry is structurally valid.");
