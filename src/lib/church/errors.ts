// Churches & Ministries People & Groups (Phase 2B): turns what the database says into a SAFE answer. Pure: no I/O.
//
// The database is the authority (RLS, constraints, guard triggers). When it refuses something the caller gets a short machine code and an HTTP status, never the raw message, the detail
// or the name of a policy / trigger / table: those describe the security design and belong in no response. The UI maps each code to a sentence in the visitor's language.

export type DbError = { code?: string | null; message?: string | null; details?: string | null; hint?: string | null } | null | undefined;

export interface Outcome {
  status: number;
  code: string;
}

// guard-trigger exception names (raise exception '<name>') -> public code
const GUARD_CODES: Record<string, Outcome> = {
  church_guardian_must_be_adult: { status: 422, code: "guardian_must_be_adult" },
  church_guardian_has_dependents: { status: 409, code: "guardian_has_dependents" },
  church_role_requires_adult: { status: 422, code: "role_requires_adult" },
  church_child_role_denied: { status: 422, code: "child_role_denied" },
  church_member_not_active: { status: 422, code: "member_not_active" },
  church_leader_assignment_denied: { status: 403, code: "leader_assignment_denied" },
  church_leader_link_denied: { status: 403, code: "forbidden" },
  church_group_has_children: { status: 403, code: "group_has_children" },
  church_membership_link_immutable: { status: 422, code: "invalid" },
  church_tenant_immutable: { status: 422, code: "invalid" },
  church_profile_required: { status: 403, code: "not_available" },
};

// constraint names -> public code (a unique index surfaces as 23505 with the index name in the message)
const CONSTRAINT_CODES: Array<[RegExp, Outcome]> = [
  [/church_groups_profile_kind_name_key/, { status: 409, code: "group_name_taken" }],
  [/church_group_members_group_member_key/, { status: 409, code: "already_in_group" }],
  [/church_leadership_open_title_key/, { status: 409, code: "appointment_exists" }],
  [/church_members_profile_(user|customer)_key/, { status: 409, code: "duplicate_member" }],
  [/church_leadership_dates_check/, { status: 422, code: "invalid_date_range" }],
  [/church_members_child_guardian_check/, { status: 422, code: "child_needs_guardian" }],
  [/church_members_child_minimal_check/, { status: 422, code: "child_contact_not_allowed" }],
  [/church_members_adult_no_guardian_check/, { status: 422, code: "adult_no_guardian" }],
  [/church_members_no_self_guardian_check/, { status: 422, code: "invalid_guardian" }],
  [/church_members_guardian_fk/, { status: 409, code: "guardian_in_use" }],
];

export function classifyDbError(error: DbError): Outcome {
  const message = String(error?.message || "");
  const code = String(error?.code || "");
  for (const name of Object.keys(GUARD_CODES)) if (message.includes(name)) return GUARD_CODES[name];
  const text = `${message} ${error?.details || ""}`;
  for (const [re, out] of CONSTRAINT_CODES) if (re.test(text)) return out;
  if (code === "42501") return { status: 403, code: "forbidden" }; // row-level security / privilege
  if (code === "23505") return { status: 409, code: "conflict" };
  if (code === "23503") return { status: 409, code: "in_use" }; // a foreign key (a person or group that is not in this church, or one still in use)
  if (code === "23514" || code === "23502" || code === "22P02" || code === "22007" || code === "22008" || code === "22001") return { status: 422, code: "invalid" };
  if (code === "40P01" || code === "40001") return { status: 409, code: "try_again" };
  return { status: 500, code: "server_error" };
}

/** What an HTTP body for a failure looks like. `field` points at the offending input where there is one. */
export const failure = (status: number, code: string, field?: string) => ({ status, body: field ? { ok: false as const, error: code, field } : { ok: false as const, error: code } });
