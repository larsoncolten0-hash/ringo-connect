// Community is a core, always-on Ringo feature — every profile behaves as
// Community-enabled regardless of what profiles.community_enabled holds.
//
// The column is deliberately KEPT (legacy code, existing rows and
// migrations still reference it, and no data is rewritten): it is simply no
// longer consulted. Every place that used to gate on it goes through this
// one function instead, so there is exactly one switch if this ever needs to
// change, and an old `false` in the database can never hide or disable
// Community (or the Connect flow layered on top of it).
//
// This says nothing about MARKETING: Community being available never
// subscribes anyone. A community_subscribers row is created only on an
// explicit marketing opt-in (see src/lib/customer/connect.ts).
export function isCommunityEnabled(_profile?: unknown): boolean {
  return true;
}
