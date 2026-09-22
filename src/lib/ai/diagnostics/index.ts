import type { WorkspaceSnapshot } from "@/lib/ai/context/snapshot";
import { DIAGNOSTIC_CHECKS } from "./checks";
import type { DiagnosticFinding } from "./types";

const SEVERITY_ORDER = { problem: 0, warning: 1, tip: 2 } as const;

/** Runs every registered check; problems first. A check that throws is skipped, never guessed. */
export function runDiagnostics(snapshot: WorkspaceSnapshot): DiagnosticFinding[] {
  const findings: DiagnosticFinding[] = [];
  for (const check of DIAGNOSTIC_CHECKS) {
    try {
      const result = check.evaluate(snapshot);
      if (result) findings.push({ id: check.id, ...result });
    } catch (error) {
      console.error(`ai diagnostic ${check.id} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

export function getDiagnosticRule(id: string): { knowledge: string; rule: string } | null {
  const check = DIAGNOSTIC_CHECKS.find((c) => c.id === id);
  return check ? { knowledge: check.knowledge, rule: check.rule } : null;
}

export type { DiagnosticFinding } from "./types";
