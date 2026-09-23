import type { CategoryId } from "@/lib/categories";
import type { KnowledgeModule } from "./types";
import { coreModule } from "./modules/core";
import { profilesModule } from "./modules/profiles";
import { categoriesModule } from "./modules/categories";
import { plansModule } from "./modules/plans";
import { catalogModule } from "./modules/catalog";
import { musicModule } from "./modules/music";
import { restaurantModule } from "./modules/restaurant";
import { eventsModule } from "./modules/events";
import { bookingsModule } from "./modules/bookings";
import { connectModule } from "./modules/connect";
import { loyaltyModule } from "./modules/loyalty";
import { teamsModule } from "./modules/teams";
import { paymentsModule } from "./modules/payments";
import { notificationsPwaModule } from "./modules/notificationsPwa";
import { onboardingModule } from "./modules/onboarding";
import { analyticsModule } from "./modules/analytics";
import { realEstateModule } from "./modules/realEstate";
import { professionalServicesModule } from "./modules/professionalServices";
import { transportLogisticsModule } from "./modules/transportLogistics";

// The knowledge registry. To teach Ringo AI about a new feature, add one
// module file and list it here — nothing else in Ringo AI changes. Order is
// deterministic (it's part of the cached prompt prefix).
export const KNOWLEDGE_MODULES: readonly KnowledgeModule[] = [
  coreModule,
  connectModule,
  profilesModule,
  categoriesModule,
  plansModule,
  catalogModule,
  musicModule,
  restaurantModule,
  eventsModule,
  bookingsModule,
  loyaltyModule,
  teamsModule,
  paymentsModule,
  notificationsPwaModule,
  onboardingModule,
  analyticsModule,
  realEstateModule,
  professionalServicesModule,
  transportLogisticsModule,
];

export const KNOWLEDGE_TOPIC_IDS: string[] = KNOWLEDGE_MODULES.map((m) => m.id);

export function getKnowledgeModule(id: string): KnowledgeModule | null {
  return KNOWLEDGE_MODULES.find((m) => m.id === id) ?? null;
}

/** Modules always present in the shared, cacheable prompt prefix. */
export function getAlwaysModules(): KnowledgeModule[] {
  return KNOWLEDGE_MODULES.filter((m) => m.appliesTo.always);
}

/** Modules auto-loaded for this profile's categories (per-user prompt part). */
export function getCategoryModules(categories: string[]): KnowledgeModule[] {
  const set = new Set(categories);
  return KNOWLEDGE_MODULES.filter(
    (m) => !m.appliesTo.always && (m.appliesTo.categories || []).some((c: CategoryId) => set.has(c))
  );
}

/** One line per module so the model knows what `lookup_ringo_help` can return. */
export function renderKnowledgeCatalog(): string {
  return KNOWLEDGE_MODULES.map((m) => `- ${m.id}: ${m.summary}`).join("\n");
}

export function renderModule(m: KnowledgeModule): string {
  return `## ${m.title} [${m.id} v${m.version}]\n${m.body}`;
}

/** Full module text for lookup, including any live facts. */
export async function renderModuleForLookup(m: KnowledgeModule): Promise<string> {
  let text = renderModule(m);
  if (m.live) {
    try {
      text += `\n${await m.live()}`;
    } catch (error) {
      console.error(`knowledge live ${m.id} failed:`, error instanceof Error ? error.message : error);
      text += "\n(Live details unavailable right now.)";
    }
  }
  if (m.related?.length) text += `\nRelated topics: ${m.related.join(", ")}`;
  return text;
}
