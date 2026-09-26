// Bookings now defaults ON for any newly-approved account whose chosen plan includes the feature
// (every paid plan today — plans.bookings_feature_enabled), instead of the column's own DB default
// of false. Free stays default-off, unchanged. The creator can still switch it off any time from
// Bookings settings — this only changes the STARTING value at account-creation time, never removes
// or restricts the existing toggle. Scoped precisely to account creation (the one place a brand-new
// account is assigned a real plan — src/app/api/admin/requests/[id]/approve/route.ts, the only
// non-demo auth.admin.createUser() call site in the codebase) — a later plan upgrade for an
// already-existing account is deliberately NOT touched, so a creator's own earlier explicit choice
// to turn bookings off is never silently overridden by an unrelated later plan change.
//   Run:  node scripts/tests/bookingDefaultOnSignup.test.mjs
import fs from "fs";
import path from "path";
import https from "https";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const read = (f) => fs.readFileSync(path.join(REPO, f), "utf8");

const results = [];
const check = (name, cond, detail = "") => {
  results.push({ name, pass: !!cond });
  if (!cond) console.log("  FAIL:", name, "|", detail);
};

// ---------------------------------------------------------------- 1. the approval route sets the new default
{
  const src = read("src/app/api/admin/requests/[id]/approve/route.ts");
  check("bookings_enabled is set from plan.bookings_feature_enabled, not hardcoded true/false", /plan\.bookings_feature_enabled \? \{ bookings_enabled: true \} : \{\}/.test(src));
  check("the plan row (with bookings_feature_enabled) is loaded BEFORE this update runs, from the real plans table — never guessed/hardcoded per plan name", /const \{ data: plan \} = await adminClient\.from\("plans"\)/.test(src));
  check(
    "this is set in the SAME profiles update call as the other 'safe because just created' defaults (category/theme), not a separate risky write",
    (() => {
      const bioIdx = src.indexOf("about_long_bio: note || null,");
      const bookingsIdx = src.indexOf("bookings_enabled: true");
      const categoryIdx = src.indexOf("...(requestCategory");
      return bioIdx !== -1 && bookingsIdx > bioIdx && bookingsIdx - bioIdx < 700 && categoryIdx > bookingsIdx && categoryIdx - bookingsIdx < 100;
    })()
  );
  check("only ONE account-creation call site exists in the codebase (auth.admin.createUser, excluding demo seeding) — confirming this is the single place that needed the fix", (() => {
    const files = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(path.join(REPO, dir), { withFileTypes: true })) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        const p = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith(".ts")) {
          const content = fs.readFileSync(path.join(REPO, p), "utf8");
          if (/auth\.admin\.createUser/.test(content)) files.push(p);
        }
      }
    };
    walk("src");
    return files.length === 2 && files.some((f) => f.includes("approve/route.ts")) && files.some((f) => f.includes("demoSeed"));
  })());
}

// ---------------------------------------------------------------- 2. the toggle itself is untouched — creators can still switch it off
{
  const cardSrc = read("src/components/dashboard/BookingSettingsCard.tsx");
  check("BookingSettingsCard.tsx (the on/off toggle UI) was not modified by this change", !/bookings_feature_enabled/.test(cardSrc));
  check("the toggle still reads its OWN initialEnabled prop and can move either direction, unrestricted", /const \[enabled, setEnabled\] = useState\(initialEnabled\)/.test(cardSrc));

  // The self-serve /auth/signup path (Free-only, no plan choice) is deliberately never touched —
  // Free isn't eligible, so its accounts should keep the column's own default (false), unchanged.
  const confirmSrc = read("src/app/auth/confirm/page.tsx");
  check("the self-serve (Free-only) signup confirmation path is untouched — no bookings_enabled logic added there", !/bookings_enabled/.test(confirmSrc));
}

// ---------------------------------------------------------------- 3. no schema change — the column's own DB default is untouched
{
  const migrationSrc = read("supabase/migrations/2026-09-18_booking_system.sql");
  check("the original column default (false) in the schema itself is untouched — this is a pure application-code change, not a migration", /bookings_enabled boolean not null default false/.test(migrationSrc));
  const allMigrations = fs.readdirSync(path.join(REPO, "supabase/migrations"));
  check("no new migration was added for this change (none was needed)", !allMigrations.some((f) => f > "2026-11-13" && /booking/i.test(f)));
}

// ---------------------------------------------------------------- 4. live: confirm which plans are actually "eligible" matches what was implemented against
{
  const envPath = path.join(REPO, ".env.local");
  if (!fs.existsSync(envPath)) {
    console.log("  (skipping live plan check — .env.local not found)");
  } else {
    const env = {};
    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
    if (env.NEXT_PUBLIC_SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
      await new Promise((resolve) => {
        const req = https.request(
          `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/plans?select=name,bookings_feature_enabled`,
          { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } },
          (res) => {
            let data = "";
            res.on("data", (c) => (data += c));
            res.on("end", () => {
              try {
                const plans = JSON.parse(data);
                const free = plans.find((p) => p.name === "free");
                const paid = plans.filter((p) => p.name !== "free");
                check("live: 'free' has bookings_feature_enabled = false (stays default-off)", free?.bookings_feature_enabled === false, JSON.stringify(free));
                check("live: every other plan has bookings_feature_enabled = true (all get default-on)", paid.length > 0 && paid.every((p) => p.bookings_feature_enabled === true), JSON.stringify(paid));
              } catch (err) {
                check("live plan check parsed successfully", false, String(err));
              }
              resolve();
            });
          }
        );
        req.on("error", () => resolve());
        req.end();
      });
    } else {
      console.log("  (skipping live plan check — Supabase credentials not set)");
    }
  }
}

const passed = results.filter((r) => r.pass).length;
console.log(`\nbooking_default_on_signup: ${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
