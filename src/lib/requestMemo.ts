import * as React from "react";

// Per-REQUEST memoisation for server loaders. A public page's metadata function and the page itself both need the same rows, and each used to run its own
// identical database query for them. Wrap the loader once and the second call in the same request returns the first call's result.
//
// It is React's request-scoped cache(): the cache lives for one server render only (never shared between visitors or requests, so it cannot serve stale or
// another person's data), and the result is keyed by the loader's arguments. Where cache() does not exist (plain Node, tests) this degrades to the original,
// uncached function, so behaviour is identical, just without the saving. Same technique as publicProfileVisibility.ts. Server only.
export const memoPerRequest: <T extends (...args: any[]) => any>(fn: T) => T = (React as any).cache ?? ((fn: any) => fn);
