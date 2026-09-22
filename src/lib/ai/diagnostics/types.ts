import type { WorkspaceSnapshot } from "@/lib/ai/context/snapshot";

// A diagnostic is a coded, deterministic check over the workspace snapshot.
// It is the ONLY way Ringo AI learns about account-specific problems: the
// model explains findings, it never invents them. Each finding carries the
// facts that triggered it and (where one exists) the dashboard path that
// fixes it, so the answer can point at the real place in Ringo.
//
// Adding a diagnostic for a new feature = one entry in checks.ts. The
// `rule` string documents which existing enforcement point the check
// mirrors, so it can be kept honest when that code changes.

export type DiagnosticSeverity = "problem" | "warning" | "tip";

export interface DiagnosticFinding {
  id: string;
  severity: DiagnosticSeverity;
  facts: Record<string, string | number | boolean | null>;
  fixPath: string | null;
}

export interface DiagnosticCheck {
  id: string;
  /** Knowledge module that explains the underlying feature. */
  knowledge: string;
  /** Which existing code path this mirrors (kept for maintainers, sent to the model as `rule`). */
  rule: string;
  evaluate: (s: WorkspaceSnapshot) => Omit<DiagnosticFinding, "id"> | null;
}
