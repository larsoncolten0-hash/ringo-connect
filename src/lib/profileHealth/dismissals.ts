// Optional, per-device "Not now" for suggestions. Same pattern the app already uses for
// ReferralPromoBanner / PushPermissionPrompt: plain localStorage, wrapped so a blocked or
// unavailable store simply means "nothing dismissed". Never critical, never synced, never stored
// server-side. Hiding a suggestion does not change the completion score or the checklist.

const keyFor = (profileId: string) => `ringo-guidance-dismissed:${profileId}`;

export function readDismissed(profileId: string): string[] {
  try {
    const raw = window.localStorage.getItem(keyFor(profileId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function writeDismissed(profileId: string, ids: string[]): void {
  try {
    window.localStorage.setItem(keyFor(profileId), JSON.stringify(Array.from(new Set(ids))));
  } catch {
    // The suggestion is still hidden for this visit.
  }
}
