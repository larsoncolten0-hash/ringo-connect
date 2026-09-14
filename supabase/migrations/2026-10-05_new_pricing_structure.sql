-- Ringo Connect — 2026 pricing restructure: Free / Basic / Pro / Business Basic /
-- Business Pro, per-plan staff seat caps, and a per-plan music/ticket commission
-- override.
--
-- CONTEXT (read before touching plans again): this repo's tracked migrations do
-- not match the live `plans` table (see PROJECT_CONTEXT.md, Section 7.0) — the
-- live schema was confirmed directly against the running database before writing
-- this file. Live columns as of this migration: id, name, display_name,
-- max_links, max_products, pixels_enabled, custom_theme_enabled,
-- full_analytics_enabled, badge_removed, created_at, price_usd, price_xaf,
-- price_usd_yearly, price_xaf_yearly, features_en, features_fr, team_enabled.
-- Four live rows: free, basic, pro, business.
--
-- WHAT THIS DOES:
--   1. Adds four new, additive columns to `plans`:
--        - max_team_seats           (int, null)      — staff seat cap; null =
--          no team access at all (Free/Basic/Pro keep this null, unchanged).
--        - commission_rate_override (numeric(5,4), null) — per-plan music/
--          ticket commission fraction; null falls back to the existing global
--          platform_settings.music_commission_rate (see
--          src/lib/musicPayoutSettings.ts's new getEffectiveMusicCommissionRate).
--          NEVER shown in any customer-facing UI — internal only, unchanged
--          posture from the existing global rate.
--        - commerce_enabled         (boolean, default true) — gates REAL
--          restaurant order placement and REAL music/ticket checkout. False
--          only on Free. Column is added here; the actual enforcement in
--          /api/orders and /api/music/orders is a separate, later change —
--          this migration only lays the flag down.
--        - bookings_feature_enabled (boolean, default true) — gates the
--          booking system at the PLAN level. False only on Free. Deliberately
--          NOT named `bookings_enabled` — that name is already used by
--          `profiles.bookings_enabled` (the per-creator on/off toggle for
--          their own page) and reusing it on `plans` for a different meaning
--          would be confusing to grep for later. Enforcement is a later change,
--          same as commerce_enabled above.
--
--   2. Re-prices/re-features the three existing non-Business rows (free,
--      basic, pro) to the new matrix, and repurposes the existing `business`
--      row into `business_pro` (new name/display_name/price/features, SAME
--      row id) rather than deleting it — nothing else in this schema
--      foreign-keys `plans.id` except `users.plan_id`, and every user
--      currently on `business` is moved off it (to `basic`, see part 3) by
--      this same migration before the rename happens, so no live subscriber
--      is ever pointed at a Business-Pro-shaped row without having actually
--      been migrated there on purpose.
--
--   3. Moves a fixed, explicitly-reviewed list of 50 existing subscriber
--      accounts (previously spread across basic/pro/business at stale,
--      inconsistent stored prices — 500/799/100 XAF respectively) onto the
--      new `basic` plan. This is confirmed to be a real non-event for
--      billing: every one of these accounts actually pays 1,000 XAF/mo (or
--      10,000 XAF/yr) today regardless of which plan row they were on — the
--      plans table's old per-row price was stale/inaccurate, not a real
--      price difference between them. No payment_transactions row is
--      created and no one is charged anything here; only `users.plan_id`
--      moves, and only for accounts already at the matching price. One
--      admin_audit_log entry is written per affected account (admin_id set
--      to the account's own id, `automated: true` in details — same pattern
--      the existing `plan_expired_downgrade` cron job already uses for an
--      automated, no-human-actor plan change) so this migration leaves a
--      normal, queryable trail like every other plan change in this app.
--
--      Deliberately excluded from this list: the one Free-plan account
--      (`mrfella`) with real Music order/ticket history — flagged separately
--      for manual owner outreach before any plan/billing change; not touched
--      by this migration at all.
--
--   4. Inserts one brand-new `business_basic` row. `price_usd`/
--      `price_usd_yearly` are confirmed NOT NULL with no default on the
--      live table (checked via information_schema before writing this),
--      so this INSERT sets them to 4 / 20 — an explicit, clearly-labeled
--      PLACEHOLDER (see part 5's own comment below for exactly why those
--      two numbers), not a real pricing decision. Real USD pricing for
--      this row is a separate, later task.
--
-- Ordering matters: the subscriber migration (part 3) runs BEFORE the
-- `business` → `business_pro` rename (part 2's last statement) specifically
-- so its audit-log entries correctly capture "movedFrom: business" for the
-- 44 affected accounts, not "movedFrom: business_pro".
--
-- Additive/idempotent throughout, same convention as every migration since
-- 2026-09-12: safe to re-run — every UPDATE re-applies the same target
-- values harmlessly, the subscriber-migration loop only touches rows not
-- already on `basic`, and the business_basic INSERT is guarded by
-- `where not exists`.
--
-- Wrapped in an explicit transaction — deliberately NOT the pattern the
-- other 32 migrations in this repo use (each of those is a set of
-- independently-safe/idempotent statements with no BEGIN/COMMIT), but this
-- one touches live subscriber billing data (part 3) ahead of a later
-- statement (part 5) in the same script — a partial apply between those two
-- is exactly what must never happen. If ANY statement below fails, the
-- whole migration rolls back as if it never ran; nothing is left
-- half-applied.
begin;

-- ============================================================================
-- 1. NEW COLUMNS
-- ============================================================================
alter table plans add column if not exists max_team_seats int;
alter table plans add column if not exists commission_rate_override numeric(5,4);
alter table plans add column if not exists commerce_enabled boolean not null default true;
alter table plans add column if not exists bookings_feature_enabled boolean not null default true;

-- ============================================================================
-- 2a. FREE — Links 1, Catalog 1 (was 0), everything else off
-- ============================================================================
update plans set
  display_name = 'Free',
  max_links = 1,
  max_products = 1,
  pixels_enabled = false,
  custom_theme_enabled = false,
  full_analytics_enabled = false,
  badge_removed = false,
  commerce_enabled = false,
  bookings_feature_enabled = false,
  team_enabled = false,
  max_team_seats = null,
  commission_rate_override = null,
  price_xaf = 0,
  price_xaf_yearly = 0,
  features_en = array[
    '1 link',
    '1 catalog item',
    'Unlimited social icons',
    'WhatsApp chat button',
    'Basic analytics (totals)'
  ],
  features_fr = array[
    '1 lien',
    '1 article au catalogue',
    'Icônes sociales illimitées',
    'Bouton de chat WhatsApp',
    'Analyses de base (totaux)'
  ]
where name = 'free';

-- ============================================================================
-- 2b. BASIC — 1,000 XAF/mo · 10,000 XAF/yr · 15 links/catalog · full toolkit
-- ============================================================================
update plans set
  display_name = 'Basic',
  max_links = 15,
  max_products = 15,
  pixels_enabled = true,
  custom_theme_enabled = true,
  full_analytics_enabled = true,
  badge_removed = true,
  commerce_enabled = true,
  bookings_feature_enabled = true,
  team_enabled = false,
  max_team_seats = null,
  commission_rate_override = 0.1000,
  price_xaf = 1000,
  price_xaf_yearly = 10000,
  features_en = array[
    'Up to 15 links',
    'Up to 15 catalog items',
    'Unlimited social icons',
    'Custom theme',
    'Facebook & TikTok pixels',
    'Full analytics with history',
    'Remove "Made with Ringo" badge',
    'Real restaurant ordering & music/ticket checkout',
    'Bookings enabled'
  ],
  features_fr = array[
    'Jusqu''à 15 liens',
    'Jusqu''à 15 articles au catalogue',
    'Icônes sociales illimitées',
    'Thème personnalisé',
    'Pixels Facebook et TikTok',
    'Analyses complètes avec historique',
    'Suppression du badge « Made with Ringo »',
    'Commandes restaurant et paiement musique/billetterie réels',
    'Réservations activées'
  ]
where name = 'basic';

-- ============================================================================
-- 2c. PRO — 2,000 XAF/mo · 20,000 XAF/yr · unlimited links/catalog
-- ============================================================================
update plans set
  display_name = 'Pro',
  max_links = null,
  max_products = null,
  pixels_enabled = true,
  custom_theme_enabled = true,
  full_analytics_enabled = true,
  badge_removed = true,
  commerce_enabled = true,
  bookings_feature_enabled = true,
  team_enabled = false,
  max_team_seats = null,
  commission_rate_override = 0.0800,
  price_xaf = 2000,
  price_xaf_yearly = 20000,
  features_en = array[
    'Unlimited links',
    'Unlimited catalog items',
    'Unlimited social icons',
    'Custom theme',
    'Facebook & TikTok pixels',
    'Full analytics with history',
    'Remove "Made with Ringo" badge',
    'Real restaurant ordering & music/ticket checkout',
    'Bookings enabled'
  ],
  features_fr = array[
    'Liens illimités',
    'Catalogue illimité',
    'Icônes sociales illimitées',
    'Thème personnalisé',
    'Pixels Facebook et TikTok',
    'Analyses complètes avec historique',
    'Suppression du badge « Made with Ringo »',
    'Commandes restaurant et paiement musique/billetterie réels',
    'Réservations activées'
  ]
where name = 'pro';

-- ============================================================================
-- 3. SUBSCRIBER MIGRATION — 50 explicitly-reviewed accounts -> `basic`.
--    Confirmed non-event for billing (see header). Excludes `mrfella`
--    (Free plan, real Music order/ticket history) by design — flagged
--    separately for manual owner outreach, never auto-migrated.
-- ============================================================================
do $$
declare
  v_basic_id uuid;
  v_row record;
  v_emails text[] := array[
    'coachcraft.space@gmail.com', 'thirdlfjjf@gmail.com', 'mokiadje@yahoo.fr',
    'rodevilekepgang@mail.com', 'swifttailor237@gmail.com', 'talid88766khkk@bowlfuel.com',
    'ebanda1manga@gmail.com', 'simplicnyonono@gmail.com', 'melodictrenchecgs@gmail.com',
    'a.sighano@ecolecanadienne-internations.ca', 'nourihaggar@gmail.com', 'ebelewilfried@gmail.com',
    'moyoakira@yahoo.fr', 'melodictrenches@gmail.com', 'bapetelbaak1929@gmail.com',
    'geobatsarl9@gmail.com', 'temikom@yahoo.com', 'socokoko5@gmail.com',
    'nkn.alphonse@yahoo.fr', 'ericnyhanjenga@gmail.com', 'tassighevaldes@gmail.com',
    'martialmbilongo195@gmail.com', 'warmachinemusic2016@gmail.com', 'moise.ebele@tractafric.com',
    'nowbemma@gmail.com', 'julesmaximenwaha31@gmail.com', 'ambadiang56@gmail.com',
    'nourihaggar1@gmail.com', 'tekedacedric91@gmail.com', 'gabriel.mballa@prestataide.biz',
    'etselectricalsolution@gmail.com', 'nakaaghondifor@gmail.com', 'nehmsdesignbtp@gmail.com',
    'contact@primeworld.com', 'menifred3@gmail.com', 'butytransitsuarl@gmail.com',
    'expert.mbei@esmcameroun.com', 'lifeandcaretb@gmail.com', 'tambevalentine@gmail.com',
    'myhomestyledesign@gmail.com', 'yadoy82340@fanzher.com', 'peresngoulapng@gmail.com',
    'bdagangmusic@gmail.com', 'constructionkembtp@gmail.com', 'paultoghanro@gmail.com',
    'nonchehyven@gmail.com', 'vavic31494@daugr.com', 'ka6c3807co@lnovic.com',
    'miraclebeats8@gmail.com', 'thierrynon2@gmail.com'
  ];
begin
  select id into v_basic_id from plans where name = 'basic';

  for v_row in
    select u.id as user_id, p.name as old_plan_name
    from users u
    join plans p on p.id = u.plan_id
    where u.email = any(v_emails)
      and u.plan_id is distinct from v_basic_id
  loop
    update users set plan_id = v_basic_id where id = v_row.user_id;

    insert into admin_audit_log (admin_id, action, target_user_id, details)
    values (
      v_row.user_id,
      'plan_migration_2026_pricing',
      v_row.user_id,
      jsonb_build_object(
        'automated', true,
        'reason', 'Consolidated onto the single new Basic plan as part of the 2026 pricing restructure — real billing amount unchanged (already paying 1,000 XAF/mo or 10,000 XAF/yr); the plans table''s stored per-plan price for the old plan was stale.',
        'movedFrom', v_row.old_plan_name,
        'movedTo', 'basic'
      )
    );
  end loop;
end $$;

-- ============================================================================
-- 4. REPURPOSE `business` -> `business_pro` — 4,000 XAF/mo · 40,000 XAF/yr ·
--    same toolkit as Pro + Team (7 seats). Runs AFTER part 3 so that loop's
--    audit trail still sees the row's old name. No-op on re-run (no row is
--    named 'business' after the first run).
-- ============================================================================
update plans set
  name = 'business_pro',
  display_name = 'Business Pro',
  max_links = null,
  max_products = null,
  pixels_enabled = true,
  custom_theme_enabled = true,
  full_analytics_enabled = true,
  badge_removed = true,
  commerce_enabled = true,
  bookings_feature_enabled = true,
  team_enabled = true,
  max_team_seats = 7,
  commission_rate_override = 0.0700,
  price_xaf = 4000,
  price_xaf_yearly = 40000,
  features_en = array[
    'Everything in Pro',
    'Team & Roles — up to 7 staff seats',
    'Invite staff with custom permissions',
    'Priority support'
  ],
  features_fr = array[
    'Tout ce qui est inclus dans Pro',
    'Équipe et rôles — jusqu''à 7 membres',
    'Invitez du personnel avec des permissions personnalisées',
    'Support prioritaire'
  ]
where name = 'business';

-- ============================================================================
-- 5. NEW ROW — business_basic — 2,500 XAF/mo · 25,000 XAF/yr · same toolkit
--    as Pro + Team (3 seats).
--
--    price_usd = 4 / price_usd_yearly = 20 below are a PLACEHOLDER, not a
--    real pricing decision — confirmed via information_schema that
--    plans.price_usd/price_usd_yearly are NOT NULL with no default, so this
--    INSERT cannot omit them. Chosen only to keep the existing round-number
--    USD ladder monotonic and consistent (free 0 -> basic 2 -> pro 3 ->
--    business_basic 4 -> business_pro 5, its existing, untouched value) and
--    to match the "yearly = monthly x 5" pattern basic/pro already both
--    use — not a currency conversion, not a business decision. Real USD
--    pricing for this row is a separate, later task; update these two
--    values then, nothing else about this row needs to change alongside it.
-- ============================================================================
insert into plans (
  name, display_name, max_links, max_products, pixels_enabled, custom_theme_enabled,
  full_analytics_enabled, badge_removed, commerce_enabled, bookings_feature_enabled,
  team_enabled, max_team_seats, commission_rate_override, price_usd, price_xaf,
  price_usd_yearly, price_xaf_yearly, features_en, features_fr
)
select
  'business_basic', 'Business Basic', null, null, true, true,
  true, true, true, true,
  true, 3, 0.0800, 4, 2500,
  20, 25000,
  array[
    'Everything in Pro',
    'Team & Roles — up to 3 staff seats',
    'Invite staff with custom permissions'
  ],
  array[
    'Tout ce qui est inclus dans Pro',
    'Équipe et rôles — jusqu''à 3 membres',
    'Invitez du personnel avec des permissions personnalisées'
  ]
where not exists (select 1 from plans where name = 'business_basic');

commit;
