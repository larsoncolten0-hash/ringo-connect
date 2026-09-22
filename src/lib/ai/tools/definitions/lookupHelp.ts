import { KNOWLEDGE_TOPIC_IDS, getKnowledgeModule, renderModuleForLookup } from "@/lib/ai/knowledge";
import type { AiTool } from "../types";

export const lookupRingoHelp: AiTool<{ topic: string }> = {
  name: "lookup_ringo_help",
  description:
    "Read Ringo's official knowledge about one feature (how it works, where it is in the dashboard, limits, common problems). Use it whenever a question touches a feature whose details are not already in your instructions. Topic ids are listed in the knowledge catalog.",
  kind: "read",
  inputSchema: {
    type: "object",
    properties: { topic: { type: "string", enum: KNOWLEDGE_TOPIC_IDS, description: "Knowledge topic id." } },
    required: ["topic"],
    additionalProperties: false,
  },
  parseInput: (raw) => {
    const topic = (raw as { topic?: unknown } | null)?.topic;
    return typeof topic === "string" && KNOWLEDGE_TOPIC_IDS.includes(topic) ? { topic } : null;
  },
  async run(_ctx, { topic }) {
    const module = getKnowledgeModule(topic);
    if (!module) return { error: "unknown_topic" };
    return { topic, content: await renderModuleForLookup(module) };
  },
};
