import { getDraftDefinition } from "./registry";
import type { DraftChange, DraftStatus, DraftType } from "./types";

// What the browser gets about a draft: the review card's content and state.
// Built on the server from the validated payload + base — never raw model
// text, never target ids or internal columns.

export interface DraftView {
  id: string;
  type: DraftType;
  status: DraftStatus;
  revision: number;
  changes: DraftChange[];
  /** Set once applied: where the owner continues in the Dashboard. */
  reviewPath: string | null;
  errorCode: string | null;
  createdAt: string;
  expiresAt: string;
}

export interface DraftRow {
  id: string;
  draft_type: string;
  status: string;
  payload: unknown;
  base: Record<string, unknown> | null;
  revision: number;
  result_id: string | null;
  error_code: string | null;
  created_at: string;
  expires_at: string;
}

export const DRAFT_VIEW_COLUMNS = "id, draft_type, status, payload, base, revision, result_id, error_code, created_at, expires_at";

export function toDraftView(row: DraftRow): DraftView | null {
  const def = getDraftDefinition(row.draft_type);
  if (!def) return null;
  const expired = row.status === "awaiting_confirmation" && new Date(row.expires_at).getTime() <= Date.now();
  return {
    id: row.id,
    type: def.type,
    status: (expired ? "expired" : row.status) as DraftStatus,
    revision: row.revision,
    changes: def.changes(row.payload, row.base),
    reviewPath: row.status === "applied" ? def.reviewPath(row.result_id) : null,
    errorCode: row.error_code,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  };
}
