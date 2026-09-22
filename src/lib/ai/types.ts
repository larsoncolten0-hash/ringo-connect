// Shared Ringo AI types. Everything under src/lib/ai/** is server-only —
// nothing here is imported by a client component except the plain string
// unions re-exported from ./codes.ts.

export type AiLocale = "en" | "fr";

export function isAiLocale(value: unknown): value is AiLocale {
  return value === "en" || value === "fr";
}

/**
 * Who is acting. Phase 1 only ever produces `owner`; `staff` exists so a
 * later phase can admit organization staff without redesigning tools —
 * every tool already declares the Team permission it needs (see
 * tools/types.ts), and an owner implicitly holds all of them, exactly like
 * getOrgAccess() in src/lib/team/access.ts.
 */
export type AiActor = { kind: "owner" } | { kind: "staff"; roleName: string; permissions: readonly string[] };

/**
 * The server-resolved identity every AI request runs under. Built ONLY by
 * guard.ts from the caller's Supabase session — never from request bodies,
 * never from model output. Tools receive it; they never receive ids from
 * the model.
 */
export interface AiWorkspace {
  userId: string;
  profileId: string;
  username: string;
  actor: AiActor;
}

export function actorHasPermission(actor: AiActor, permission: string | undefined): boolean {
  if (!permission) return true;
  if (actor.kind === "owner") return true;
  return actor.permissions.includes(permission);
}
