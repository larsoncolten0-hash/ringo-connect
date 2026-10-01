// Client-safe share-link constants (no Node crypto): shared by the owner UI and the server token module.
export const SHARE_DEFAULT_DAYS = 14;
export const SHARE_MAX_DAYS = 90;
export const SHARE_MAX_ACTIVE = 5; // mirrors the database limit in doc_create_share (the database is the authority)
