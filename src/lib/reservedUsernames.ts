// Usernames a creator may NOT claim, because a real route already lives at
// that path and would shadow (or be shadowed by) their public page at
// /[username]. Next.js resolves static segments before the dynamic
// `[username]` one, so a creator holding one of these would get a public
// page nobody can reach.
//
// Kept deliberately minimal: only routes added with a reservation in mind
// are listed here — this is not a retroactive blocklist for other existing
// top-level routes.
//
//   my-ringo -> /my-ringo (the customer's own space, src/app/my-ringo)
//
// Every current username input already strips characters outside
// [a-z0-9_], so a hyphenated name can't be typed into those forms today;
// this exists so the rule also holds server-side (the approve route) and
// keeps holding if that input filtering is ever loosened.
const RESERVED_USERNAMES = new Set<string>(["my-ringo"]);

export function isReservedUsername(username: unknown): boolean {
  return typeof username === "string" && RESERVED_USERNAMES.has(username.trim().toLowerCase());
}
