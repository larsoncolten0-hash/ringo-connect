import { KNOWLEDGE_MODULES } from "./index";
import type { KnowledgeModule, KnowledgeStatus } from "./types";

// Structural + light semantic validation over the knowledge registry (and, optionally, the
// diagnostics that reference it). Deliberately does NOT try to verify a module's `status`
// against the real codebase (routes, tables, feature flags) — that is exactly the "fragile
// magic" this project's own convention asks to avoid (see types.ts's header comment). `status`
// is a human assertion, made from actual current app behavior; this only catches malformed or
// inconsistent REGISTRATION, never a mistaken but well-formed one.

const VALID_STATUSES: readonly KnowledgeStatus[] = ["live", "partial", "planned", "unavailable"];

// A crude, deliberately narrow heuristic, not a secret scanner — it only exists to catch an
// obvious mistake (a real key/token pasted into what should be product-capability prose).
const SECRET_LOOKING_PATTERNS: RegExp[] = [
  /sk_(live|test)_[A-Za-z0-9]/i,
  /whsec_[A-Za-z0-9]/i,
  /AIza[0-9A-Za-z_-]{10,}/,
  /\bapi[_-]?key\b\s*[:=]\s*['"A-Za-z0-9]/i,
  /\bpassword\b\s*[:=]/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
];

function textFieldsOf(m: KnowledgeModule): string[] {
  return [m.title, m.summary, m.body, m.whoCanUse, ...(m.actions || []), ...(m.prerequisites || []), ...(m.limitations || [])].filter(
    (v): v is string => typeof v === "string"
  );
}

/** Returns an empty array when the registry is valid; otherwise one message per problem found. */
export function validateKnowledgeModules(modules: readonly KnowledgeModule[] = KNOWLEDGE_MODULES): string[] {
  const errors: string[] = [];
  const seenIds = new Set<string>();
  const allIds = new Set(modules.map((m) => m.id));

  for (const m of modules) {
    const where = `module "${m.id || "(missing id)"}"`;

    if (!m.id || typeof m.id !== "string") errors.push(`${where}: missing or invalid id`);
    else if (seenIds.has(m.id)) errors.push(`duplicate knowledge module id: "${m.id}"`);
    else seenIds.add(m.id);

    if (!Number.isInteger(m.version) || m.version < 1) errors.push(`${where}: version must be a positive integer`);
    if (!m.title?.trim()) errors.push(`${where}: missing title`);
    if (!m.summary?.trim()) errors.push(`${where}: missing summary`);
    if (!m.body?.trim()) errors.push(`${where}: missing body`);
    if (!m.appliesTo) errors.push(`${where}: missing appliesTo`);

    if (m.status !== undefined && !VALID_STATUSES.includes(m.status)) {
      errors.push(`${where}: invalid status "${m.status}" (expected one of ${VALID_STATUSES.join(", ")})`);
    }

    for (const relatedId of m.related || []) {
      if (!allIds.has(relatedId)) errors.push(`${where}: related id "${relatedId}" does not exist`);
    }

    for (const field of textFieldsOf(m)) {
      for (const pattern of SECRET_LOOKING_PATTERNS) {
        if (pattern.test(field)) {
          errors.push(`${where}: text matches a secret-shaped pattern (${pattern}) — remove it from platform knowledge`);
          break;
        }
      }
    }
  }

  return errors;
}

/**
 * Every diagnostic must point at a knowledge module that actually exists — otherwise
 * lookup_ringo_help has nothing to return when the model tries to explain a finding. Takes the
 * checks as a parameter rather than importing diagnostics/checks.ts directly, so knowledge/ and
 * diagnostics/ stay linked only by id, never by a module import in either direction.
 */
export function validateDiagnosticReferences(
  checks: readonly { id: string; knowledge: string }[],
  modules: readonly KnowledgeModule[] = KNOWLEDGE_MODULES
): string[] {
  const errors: string[] = [];
  const allIds = new Set(modules.map((m) => m.id));
  const seenCheckIds = new Set<string>();
  for (const c of checks) {
    if (seenCheckIds.has(c.id)) errors.push(`duplicate diagnostic id: "${c.id}"`);
    else seenCheckIds.add(c.id);
    if (!allIds.has(c.knowledge)) errors.push(`diagnostic "${c.id}": knowledge id "${c.knowledge}" does not exist`);
  }
  return errors;
}
