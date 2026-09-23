import { actorHasPermission } from "@/lib/ai/types";
import type { AiToolSpec } from "@/lib/ai/providers/types";
import type { AiTool, AiToolContext, AiToolKind } from "./types";
import { AI_TOOLS } from "./index";

// Read tools, plus Phase 2 draft tools (which only PREPARE drafts; applying
// needs the owner's Confirm & Apply click). "write" stays unreachable even if
// one is registered by mistake — there is no model-callable mutation.
const EXPOSED_KINDS: readonly AiToolKind[] = ["read", "draft"];

const MAX_RESULT_CHARS = 6000;
const TOOL_TIMEOUT_MS = 10_000;

/** The tools this workspace may use right now (kind, permission, feature). */
export function getAvailableTools(ctx: AiToolContext): AiTool<any>[] {
  return AI_TOOLS.filter(
    (tool) =>
      EXPOSED_KINDS.includes(tool.kind) &&
      actorHasPermission(ctx.workspace.actor, tool.permission) &&
      (tool.available ? tool.available(ctx.snapshot) : true)
  );
}

export function toToolSpecs(tools: AiTool<any>[]): AiToolSpec[] {
  return tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

export interface ToolExecution {
  content: string;
  isError: boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("tool timeout")), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/**
 * Runs one tool call from the model. The tool must be in the workspace's
 * available set (a name the model invents, or a tool this workspace can't
 * use, is refused), its input is re-validated, and its output is size-capped.
 * Failures return a generic error to the model — never a stack trace or a
 * database message.
 */
export async function executeTool(name: string, rawInput: unknown, ctx: AiToolContext, available: AiTool<any>[]): Promise<ToolExecution> {
  const tool = available.find((t) => t.name === name);
  if (!tool) return { content: JSON.stringify({ error: "tool_not_available" }), isError: true };

  const input = tool.parseInput(rawInput);
  if (input === null) return { content: JSON.stringify({ error: "invalid_input" }), isError: true };

  try {
    const result = await withTimeout(tool.run(ctx, input), TOOL_TIMEOUT_MS);
    let content = JSON.stringify(result);
    if (content.length > MAX_RESULT_CHARS) {
      content = JSON.stringify({ truncated: true, partial: content.slice(0, MAX_RESULT_CHARS - 200) });
    }
    return { content, isError: false };
  } catch (error) {
    console.error(`ai tool ${name} failed:`, error instanceof Error ? error.message : error);
    return { content: JSON.stringify({ error: "tool_failed", note: "Could not read this data right now; do not guess it." }), isError: true };
  }
}
