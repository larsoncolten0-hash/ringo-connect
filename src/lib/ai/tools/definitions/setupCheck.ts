import { runDiagnostics, getDiagnosticRule } from "@/lib/ai/diagnostics";
import { NO_INPUT_SCHEMA, parseNoInput, type AiTool } from "../types";

export const runMySetupCheck: AiTool = {
  name: "run_my_setup_check",
  description:
    "Run Ringo's built-in checks on the user's own account and return every detected problem, warning and tip with the facts behind it and the dashboard path that fixes it. This is the only source of truth for account problems — never report a problem it didn't return. An empty list means no known issue was detected.",
  kind: "read",
  permission: "settings.view",
  inputSchema: NO_INPUT_SCHEMA,
  parseInput: parseNoInput,
  async run({ snapshot }) {
    const findings = runDiagnostics(snapshot).map((f) => ({ ...f, ...getDiagnosticRule(f.id) }));
    return { checked_at: snapshot.loadedAt, findings_count: findings.length, findings };
  },
};
