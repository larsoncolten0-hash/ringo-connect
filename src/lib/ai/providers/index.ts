import { anthropicProvider } from "./anthropic";
import type { AiProvider } from "./types";

// Provider registry. ai_settings.provider picks one by id; adding a provider
// is one adapter file plus one entry here.
const PROVIDERS: Record<string, AiProvider> = {
  [anthropicProvider.id]: anthropicProvider,
};

export function getAiProvider(id: string): AiProvider | null {
  return PROVIDERS[id] ?? null;
}
