// The fixed vocabulary of the public group pages and the Pastors page. Pure and browser-safe: the dashboard screens and the server handlers both import it.

export const PUBLIC_GROUP_KINDS = ["men", "women", "youths", "children"] as const;
export type PublicGroupKind = (typeof PUBLIC_GROUP_KINDS)[number];
export const isPublicGroupKind = (v: unknown): v is PublicGroupKind => typeof v === "string" && (PUBLIC_GROUP_KINDS as readonly string[]).includes(v);

/** A group shows at most this many photos (the database enforces it too). */
export const GROUP_PHOTO_LIMIT = 12;
/** A church shows at most this many pastors. */
export const PASTOR_LIMIT = 12;
