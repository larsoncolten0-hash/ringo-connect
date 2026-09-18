import { randomUUID } from "crypto";
import { createAdminClient } from "@/lib/supabase/server";
import type { Locale } from "@/lib/i18n/translations";

// Pre-seeds a freshly-created demo Association (see /api/demo/create) with
// sample Partners, Members, and activity history, so "Try the Association
// Program" is immediately meaningful rather than an empty dashboard.
//
// Demo Partners are real, independent, throwaway profiles — created via
// the exact same admin.auth.admin.createUser() pattern
// src/app/api/admin/requests/[id]/approve/route.ts already uses to
// provision an account without touching the caller's own session, which
// fires the same handle_new_auth_user trigger a normal signup does. Each
// is flagged is_demo/demo_expires_at identically to the Association Owner
// itself, so the EXISTING cleanup cron (/api/cron/cleanup-demo-accounts,
// unmodified) finds and removes them on its own — no new is_demo column or
// cleanup path needed anywhere.
//
// Demo Members need no such treatment at all: they aren't `profiles` rows,
// so they (and their point transactions, rewards, settings) simply
// cascade-delete the moment the Owner's own profile is removed by that
// same cron — see association_members/association_point_transactions/
// association_rewards/association_settings's `on delete cascade` in
// 2026-09-18_association_program.sql. Nothing new to add there either.
//
// Best-effort by design (see the caller in /api/demo/create): a failure
// here leaves a valid, usable, just-empty demo account rather than
// blocking demo creation entirely.

type Admin = ReturnType<typeof createAdminClient>;

const SAMPLE_PARTNERS = [
  { username: "chez-marie", name: "Chez Marie", category: "restaurant_food" as const },
  { username: "salon-eclat", name: "Salon Éclat", category: "beauty_wellness" as const },
  { username: "boutique-fatou", name: "Boutique Fatou", category: "business_ecommerce" as const },
];

const SAMPLE_MEMBERS = [
  { name: "Jean-Paul Mbarga", phone: "677 11 22 33" },
  { name: "Amina Njoya", phone: "699 44 55 66" },
  { name: "Divine Fotso", phone: "655 77 88 99" },
];

const REWARDS_BY_LOCALE: Record<Locale, { name: string; description: string; pointsCost: number }[]> = {
  en: [
    { name: "Free coffee", description: "One free coffee at any Partner", pointsCost: 50 },
    { name: "10% off your next visit", description: "Redeemable at any Partner", pointsCost: 100 },
    { name: "Free tote bag", description: "While supplies last", pointsCost: 200 },
  ],
  fr: [
    { name: "Café offert", description: "Un café offert chez n'importe quel Partenaire", pointsCost: 50 },
    { name: "10% de réduction", description: "Valable chez n'importe quel Partenaire", pointsCost: 100 },
    { name: "Sac offert", description: "Dans la limite des stocks disponibles", pointsCost: 200 },
  ],
};

async function createDemoPartnerProfile(admin: Admin, sample: (typeof SAMPLE_PARTNERS)[number], demoExpiresAt: string) {
  const suffix = randomUUID().replace(/-/g, "").slice(0, 8);
  const { data: created, error } = await admin.auth.admin.createUser({
    email: `demo-partner-${suffix}@ringo-demo.internal`,
    password: randomUUID(),
    email_confirm: true,
    user_metadata: { username: `${sample.username}-${suffix}` },
  });
  if (error || !created.user) throw new Error(error?.message || "could not create demo partner user");

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .update({ name: sample.name, category: sample.category, is_demo: true, demo_expires_at: demoExpiresAt })
    .eq("user_id", created.user.id)
    .select("id")
    .single();
  if (profileError || !profile) throw new Error(profileError?.message || "could not set up demo partner profile");

  return profile.id as string;
}

export async function seedDemoAssociation(
  admin: Admin,
  { associationProfileId, demoExpiresAt, locale }: { associationProfileId: string; demoExpiresAt: string; locale: Locale }
) {
  // Partners — created and linked one at a time (not Promise.all) so a
  // single failure partway through doesn't leave auth users created with
  // no way to identify/clean them up individually; the caller's own
  // try/catch treats any failure here as fully best-effort regardless.
  const partnerProfileIds: string[] = [];
  for (const sample of SAMPLE_PARTNERS) {
    const partnerProfileId = await createDemoPartnerProfile(admin, sample, demoExpiresAt);
    partnerProfileIds.push(partnerProfileId);
  }

  await admin.from("association_partners").insert(
    partnerProfileIds.map((partnerProfileId) => ({
      association_profile_id: associationProfileId,
      partner_profile_id: partnerProfileId,
      status: "active",
      joined_at: new Date().toISOString(),
    }))
  );

  await admin.from("association_settings").insert({
    association_profile_id: associationProfileId,
    points_per_amount: 1,
    amount_unit: 100,
    default_momo_number: "677 00 00 00",
  });

  const rewardRows = REWARDS_BY_LOCALE[locale].map((r, i) => ({
    association_profile_id: associationProfileId,
    name: r.name,
    description: r.description,
    points_cost: r.pointsCost,
    sort_order: i,
  }));
  const { data: rewards } = await admin.from("association_rewards").insert(rewardRows).select("id, points_cost");

  // Members — each gets a small, realistic transaction history (a mix of
  // earn and redeem) inserted directly rather than through the
  // log_association_earn/log_association_redeem RPCs: this is bulk seed
  // data being backfilled at account-creation time, not a real tap event,
  // so there's no card, no acting Partner, and no reason to route it
  // through the atomic-balance-update path those RPCs exist for. The
  // final points_balance is computed here to stay exactly consistent with
  // the transactions actually inserted below.
  for (let i = 0; i < SAMPLE_MEMBERS.length; i++) {
    const sample = SAMPLE_MEMBERS[i];
    const { data: member } = await admin
      .from("association_members")
      .insert({ association_profile_id: associationProfileId, name: sample.name, phone: sample.phone, points_balance: 0 })
      .select("id")
      .single();
    if (!member) continue;

    const earnAmount = 1500 + i * 500;
    const earnPoints = Math.floor(earnAmount / 100);
    let balance = earnPoints;

    const transactions: Record<string, any>[] = [
      {
        association_profile_id: associationProfileId,
        member_id: member.id,
        partner_profile_id: partnerProfileIds[i % partnerProfileIds.length],
        type: "earn",
        amount_xaf: earnAmount,
        points_delta: earnPoints,
      },
    ];

    // Every other Member also has one redemption in their history, so the
    // activity view and Member view both show a realistic mix, not just
    // uniform "earn" rows.
    if (i % 2 === 0 && rewards && rewards.length > 0) {
      const reward = rewards[i % rewards.length];
      if (balance >= reward.points_cost) {
        balance -= reward.points_cost;
        transactions.push({
          association_profile_id: associationProfileId,
          member_id: member.id,
          partner_profile_id: partnerProfileIds[i % partnerProfileIds.length],
          type: "redeem",
          points_delta: -reward.points_cost,
          reward_id: reward.id,
        });
      }
    }

    await admin.from("association_point_transactions").insert(transactions);
    await admin.from("association_members").update({ points_balance: balance }).eq("id", member.id);
  }
}
