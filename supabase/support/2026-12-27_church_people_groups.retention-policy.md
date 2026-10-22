# Church people and groups: account deletion and data retention

Companion to `supabase/migrations/2026-12-27_church_people_groups.sql` (Churches & Ministries Phase 2A). Written so the behaviour is explicit before anyone relies on it.
**Nothing here is automated erasure.** The migration builds no job, trigger or cron that deletes or anonymises identifiable data. The only automatic effects are the ones listed under
"What the database does today"; everything else is an open decision for the owner, listed at the end.

## What the data is

A church's roster, groups, group memberships and leadership titles. Belonging to a church can itself reveal religious affiliation, so the **whole roster is treated as sensitive**, not only
named fields. Children's records are held to a stricter standard (name, age group and guardian link only). No counselling, donation, giving or attendance data exists in this schema.

The church (the owner of the profile) decides what is recorded about a person and why; Ringo provides the tool. Ringo staff (platform admins) have no access through the product and are
refused by the database policies (see "Not preventable" below).

## What the database does today

| Event | Effect | Reversible? |
|---|---|---|
| A Ringo account is deleted (`auth.users`, and with it `public.users`) | `church_members.user_id` becomes NULL. **The church's record, its group memberships and leadership rows are kept.** Staff access (`organization_members`) is removed by the existing cascade. | The link is lost; the record is intact. |
| A visitor identity (`ringo_customers`) is deleted | `church_members.customer_id` becomes NULL. The record is kept. | Same. |
| A record is removed from the roster in the app | Soft removal: `status = 'removed'`, `removed_at` is stamped. Nothing is deleted. A removed record stops counting for access (group leadership lapses, "own record" access ends) but stays in the table. | Yes (set the status back). |
| A record is hard-deleted (needs `church.members.delete`, owner-only to grant; hard-deleting a child's record needs `church.members.delete`, `church.children.manage` and `church.children.view`, because the caller must also be able to see the child; the owner holds all of them) | The row is deleted; that person's group memberships and leadership rows are deleted with it. | **No.** |
| An adult who is still a guardian is hard-deleted | **Refused** by the database until the dependent child's record is dealt with. | n/a |
| The church's profile is deleted | Every row in these four tables is deleted (as for every other table scoped to a profile). | **No.** |
| **The church OWNER's Ringo account is deleted** | **The whole roster goes with it.** `auth.users` -> `public.users` (`id ... references auth.users on delete cascade`) -> `profiles` (`user_id ... on delete cascade`) -> all four tables (`profile_id ... on delete cascade`). That deletes the church's profile, every person record (including children's), every group, every group membership and every leadership record. Nothing is detached or kept, unlike the member-account case above. This is the existing, platform-wide behaviour for anything scoped to a profile; Phase 2A does not change it. | **No.** |
| A group is deleted | Its membership rows are deleted, including the memberships of children; the people stay on the roster. A group that holds a child can only be deleted by the owner or a holder of `church.children.manage` (a database trigger, `church_groups_delete_guard`); a group without a child can be deleted with `church.groups.manage` alone. The service role and the cascade from deleting the church's profile are not restricted by this: that cascade is authorised by the profile's own delete policy (its owner, or a platform admin), which Phase 2A does not change. | No. |
| An adult who is a child's guardian is soft-removed or made inactive | **Allowed.** The child's record keeps pointing at that guardian (see open decision 8). | Yes. |

There is **no retention timer**: a soft-removed record stays until someone hard-deletes it.

## Audit trail

Roster changes should be logged to the existing `organization_activity_log` with **identifiers only** (record id, action name), never names, contact details or the reason. This is a rule for
the Phase 2B code; the Phase 2A schema adds no log of its own.

## Not preventable from inside the database

Someone using the service role, the Supabase dashboard or a direct database connection is not subject to row-level security. Keeping the roster away from Ringo operators is therefore an
operational control (who holds those credentials, and access logging), not something this migration can guarantee.

## Open policy decisions (deliberately NOT implemented; each needs the owner's decision, and probably legal review)

1. **Retention period** for soft-removed records, and whether a purge job should exist at all.
2. **Account deletion:** keep the church's record (today's behaviour), anonymise it (name to a placeholder, contact cleared), or delete it. The right answer depends on the church's legal basis for
   holding the record and on whether the person asked for erasure; the database cannot know either.
3. **A person's own erasure request** (they are not the owner and have no staff access): through whom, and how the church proves it was honoured. Needs a defined route; none is built.
4. **Age boundaries:** what age the `child` and `youth` groups mean, and whether a youth may register or hold an account on their own. Today `child` is strict (no account, no contact details, no
   self-registration); `youth` is not restricted beyond requiring an adult guardian when one is recorded.
5. **Consent and notices:** the wording shown to people (and to guardians for children) when their details are recorded. Not a database matter, but a prerequisite for using the feature in production.
6. **Data-protection law:** which law applies to churches using the product (including any local personal-data law and its rules on special-category data), and what registration or impact
   assessment it requires. This has not been reviewed.
7. **Roster visibility for group members:** today a plain group member, volunteer or worker sees only their own membership; only leaders and assistants see their group's roster. Widening that
   (for example, letting volunteers see each other's names) is a privacy decision.
8. **Guardian removal:** whether removing or deactivating a guardian while a child's record depends on them should be blocked, warned about, or require naming a new guardian. Today it is allowed.
   Hard-deleting such a guardian is already refused. Not implemented, because it is a policy choice.
9. **Group deletion and children — decided and implemented in Phase 2A:** deleting a group that holds a child needs `church.children.manage` (see the table above). Kept here for the record; 
   nothing further is open.
10. **Owner-account cascade:** whether deleting an owner's account should instead be blocked while a roster exists, or hand the church to another administrator. Today the roster is deleted with the account.
