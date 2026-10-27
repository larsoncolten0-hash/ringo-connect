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
  daily_word_profile_required: { status: 403, code: "not_available" },
  daily_word_tenant_immutable: { status: 422, code: "invalid" },
  // Phase 4 (events and announcements)
  ministry_profile_required: { status: 403, code: "not_available" },
  ministry_tenant_immutable: { status: 422, code: "invalid" },
  // Phase 7 (attendance)
  attendance_immutable: { status: 409, code: "invalid" },
  attendance_tenant_immutable: { status: 422, code: "invalid" },
  attendance_event_missing: { status: 404, code: "not_found" },
  attendance_member_missing: { status: 404, code: "member_not_found" },
  attendance_event_not_published: { status: 409, code: "event_not_open" },
  attendance_event_cancelled: { status: 409, code: "event_cancelled" },
  attendance_event_not_started: { status: 409, code: "event_not_started" },
  attendance_child_not_allowed: { status: 422, code: "child_not_allowed" },
  attendance_member_not_active: { status: 422, code: "member_not_active" },
  // Phase 5 (Bible programs)
  bible_profile_required: { status: 403, code: "not_available" },
  bible_tenant_immutable: { status: 422, code: "invalid" },
  bible_program_needs_sessions: { status: 422, code: "needs_sessions" },
  bible_session_limit: { status: 422, code: "session_limit" },
  bible_program_unavailable: { status: 409, code: "program_unavailable" },
  bible_enrollment_immutable: { status: 409, code: "invalid" },
  bible_progress_immutable: { status: 409, code: "invalid" },
  // Phase 8 (music links)
  music_profile_required: { status: 403, code: "not_available" },
  music_tenant_immutable: { status: 422, code: "invalid" },
  music_link_limit: { status: 422, code: "music_link_limit" },
  // Phase 9 (care cases and consent)
  care_profile_required: { status: 403, code: "not_available" },
  care_tenant_immutable: { status: 422, code: "invalid" },
  care_consent_required: { status: 422, code: "needs_consent" },
  care_consent_immutable: { status: 409, code: "invalid" },
  care_member_missing: { status: 404, code: "member_not_found" },
  care_child_not_allowed: { status: 422, code: "care_child_not_allowed" },
  // Testimonies
  testimony_profile_required: { status: 403, code: "not_available" },
  testimony_original_immutable: { status: 422, code: "invalid" },
  testimony_consent_cannot_be_granted: { status: 403, code: "consent_cannot_be_granted" },
  testimony_status_invalid: { status: 422, code: "invalid" },
  testimony_cannot_publish: { status: 409, code: "cannot_publish" },
  testimony_publish_permission: { status: 403, code: "forbidden" },
  testimony_history_immutable: { status: 409, code: "invalid" },
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
  [/daily_words_one_published_per_day_key/, { status: 409, code: "date_taken" }],
  [/daily_words_publish_content_check/, { status: 422, code: "needs_title_and_body" }],
  // Phase 4
  [/ministry_events_times_check/, { status: 422, code: "invalid_time_range" }],
  [/ministry_events_online_url_check/, { status: 422, code: "invalid_online_url" }],
  // Phase 2 (pictures): the address shape, and a care picture without the recorded confirmation
  [/ministry_(events|announcements|care_cases)_image_url_check/, { status: 422, code: "invalid_image_url" }],
  [/ministry_care_cases_image_consent_check/, { status: 422, code: "image_consent_required" }],
  [/ministry_events_publish_content_check/, { status: 422, code: "needs_title" }],
  [/ministry_announcements_publish_content_check/, { status: 422, code: "needs_title_and_body" }],
  // Phase 7: an event that has attendance cannot be deleted (the foreign key is NO ACTION); recording twice is a unique-key conflict; a count outside its range
  [/update or delete on table "ministry_events" violates foreign key constraint "ministry_attendance(_counts)?_event_fk"/, { status: 409, code: "event_has_attendance" }],
  [/ministry_attendance_event_member_key/, { status: 409, code: "already_recorded" }],
  [/ministry_attendance_counts_(visitors|children)_check/, { status: 422, code: "invalid_count" }],
  // Phase 5: a programme without a title cannot be published; a session needs a title; a position is taken; a programme with participants cannot be deleted
  [/bible_programs_publish_content_check/, { status: 422, code: "needs_title" }],
  [/bible_program_sessions_title_check/, { status: 422, code: "session_needs_title" }],
  [/bible_program_sessions_position_key/, { status: 409, code: "try_again" }],
  [/update or delete on table "bible_programs" violates foreign key constraint "bible_enrollments_program_fk"/, { status: 409, code: "program_has_participants" }],
  // Phase 8: the same address twice; a bad address, label, platform or order
  [/ministry_music_links_profile_url_key/, { status: 409, code: "link_exists" }],
  [/ministry_music_links_url_check/, { status: 422, code: "invalid_url" }],
  [/ministry_music_links_title_check/, { status: 422, code: "invalid_title" }],
  [/ministry_music_links_platform_check/, { status: 422, code: "invalid_platform" }],
  // Phase 9: a case needs a title and a summary in one language to be published; the category is a fixed list
  [/ministry_care_cases_publish_content_check/, { status: 422, code: "needs_title_and_summary" }],
  [/ministry_care_cases_category_check/, { status: 422, code: "invalid_category" }],
  [/ministry_care_beneficiaries_pkey/, { status: 409, code: "conflict" }],
  // Testimonies: a corrected text or a note outside its limits
  [/ministry_testimonies_public_body_check/, { status: 422, code: "invalid_public_body" }],
  [/ministry_testimonies_note_check/, { status: 422, code: "invalid_note" }],
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
