// The EXACT files the Phase 5 infrastructure / secrets audit changes or adds: the Next.js image optimizer is switched off (next.config.js) and a regression test
// pins it together with the secrets / environment hygiene checks. No migration, no dependency, no auth, RLS or payment file. Same convention as
// phase16Files.mjs: explicit, no wildcards.
export const PHASE20_FILES = new Set([
  "next.config.js",
  "scripts/tests/phase20Files.mjs",
  "scripts/tests/phase16Files.mjs",
  "scripts/tests/securityPhase5.test.mjs",
  "scripts/tests/ownerWorkspaceFiles.mjs",
]);

// The files of this phase that sit inside an area an OLDER scope guard protects ("no config file"): exempted by exact path, never by directory.
export const PHASE20_PROTECTED_FILES = new Set(["next.config.js"]);
export const isPhase20ProtectedFile = (f) => PHASE20_PROTECTED_FILES.has(String(f).replace(/\\/g, "/"));
