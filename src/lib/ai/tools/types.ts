import type { AiLocale, AiWorkspace } from "@/lib/ai/types";
import type { WorkspaceSnapshot } from "@/lib/ai/context/snapshot";

// A Ringo AI tool is an explicitly defined, server-side capability. The model
// can only ask for a tool by name with a small, validated input; it never
// supplies ids, table names or queries. Every run receives the
// server-resolved workspace and must scope every query to
// ctx.workspace.profileId itself.
//
//   kind "read"  — Phase 1. Reads and summarizes the owner's own data.
//   kind "draft" — Phase 2. Prepares a proposal (ai drafts), never writes Ringo data.
//   kind "write" — Phase 3. Executes only after explicit user confirmation, via
//                  existing Ringo logic. The registry refuses to expose
//                  anything but "read" until those phases are built.

export type AiToolKind = "read" | "draft" | "write";

export interface AiToolContext {
  workspace: AiWorkspace;
  snapshot: WorkspaceSnapshot;
  locale: AiLocale;
}

export interface AiTool<Input = Record<string, never>> {
  name: string;
  description: string;
  kind: AiToolKind;
  /** Team permission a staff actor would need (owners hold all). */
  permission?: string;
  /** Hide the tool when the workspace doesn't have the feature. */
  available?: (snapshot: WorkspaceSnapshot) => boolean;
  /** JSON Schema; every property required, additionalProperties false. */
  inputSchema: Record<string, unknown>;
  /** Re-validates the model's input server-side; null = reject. */
  parseInput: (raw: unknown) => Input | null;
  run: (ctx: AiToolContext, input: Input) => Promise<unknown>;
}

export const NO_INPUT_SCHEMA: Record<string, unknown> = { type: "object", properties: {}, required: [], additionalProperties: false };

export function parseNoInput(raw: unknown): Record<string, never> | null {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  return Object.keys(raw as object).length === 0 ? {} : null;
}

/** Clip user-generated text before it goes into a tool result (it is data, not instructions). */
export function clipText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const t = value.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
}
