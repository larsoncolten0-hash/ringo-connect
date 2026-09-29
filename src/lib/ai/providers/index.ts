import { anthropicProvider } from "./anthropic";
import { openaiProvider } from "./openai";
import type { AiProvider } from "./types";

// Provider registry. ai_settings.provider picks one by id; adding a provider
// is one adapter file plus one entry here.
const PROVIDERS: Record<string, AiProvider> = {
  [anthropicProvider.id]: anthropicProvider,
  [openaiProvider.id]: openaiProvider,
};

export function getAiProvider(id: string): AiProvider | null {
  return PROVIDERS[id] ?? null;
}

/** Ids of every registered provider (for the admin UI's provider picker). */
export function listAiProviderIds(): string[] {
  return Object.keys(PROVIDERS);
}
