// Pure helper behind "Discard": put the keys a section touched back to what the server says is saved.
// The preview draft is a mirror of the profile plus whatever is being edited right now; after a discard,
// ONLY the keys that the discarded section changed are restored, so unrelated unsaved work elsewhere
// (for example the always-open Profile card) is left alone.

export type DraftProfile = Record<string, any>;

/** Returns a new draft where each of `keys` takes the server's value. Other keys keep their current value. */
export function restoreKeys(draft: DraftProfile, server: DraftProfile, keys: Iterable<string>): DraftProfile {
  const next = { ...draft };
  for (const key of keys) next[key] = server[key];
  return next;
}
