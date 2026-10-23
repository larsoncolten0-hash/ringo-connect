// Churches & Ministries Phase 6: the Church Store, checked OFFLINE (no database, no network, no dev server).
// The Church Store is NOT a new store: it is the church's existing Ringo Shop, labelled "Church Store" on the public page. Phase 6 adds one owner-only dashboard entry that explains this and links to the
// Shop. These tests pin that: nothing new in the database, no payment or order code touched, the public label and order intact, owner-only, bilingual.
//   Run:  node scripts/tests/churchStore.test.mjs
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { REPO, SRC, read, noComments, jiti, translations, walkDictionary, sourceProblems, component, html } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

const PERM = jiti(path.join(SRC, "lib/church/permissions.ts"));

// ---------------------------------------------------------------- 1. dictionary
{
  const out = walkDictionary(translations.en.churchStore, translations.fr.churchStore, "churchStore");
  check("EN and FR have exactly the same keys, types and list lengths", out.shape.length === 0, out.shape.join("; "));
  check("no empty text in either language", out.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  check("French is a translation, not a copy", out.strings.filter(([, a, b]) => a === b && a.length > 6).length === 0);
  const e = translations.en.churchStore, f = translations.fr.churchStore;
  check("the public name is stated exactly as the category label states it", e.title === "Church Store" && f.title === "Boutique de l'église");
  check("the screen says orders and payments are untouched, in both languages", e.points.some((p) => /Orders and payments are handled by the Shop/.test(p)) && f.points.some((p) => /commandes et les paiements sont gérés par la Boutique/i.test(p)));
  check("the tab label exists in both languages", translations.en.churchWorkspace.tabs.store === "Store" && translations.fr.churchWorkspace.tabs.store === "Boutique");
  check("the restricted sentence exists in both languages", translations.en.churchWorkspace.restricted.store.length > 10 && translations.fr.churchWorkspace.restricted.store.length > 10);
}

// ---------------------------------------------------------------- 2. the screen
{
  const Entry = component("components/church/store/ChurchStoreEntry.tsx");
  for (const lang of ["en", "fr"]) {
    const c = translations[lang].churchStore;
    const open = html(Entry, { shopAvailable: true }, lang);
    check(`entry (${lang}): subtitle, every point, and a link to the Shop`, open.includes(c.subtitle) && c.points.every((p) => open.includes(p)) && open.includes('href="/dashboard/shop"') && open.includes(c.openShop) && !open.includes(c.unavailable));
    const closed = html(Entry, { shopAvailable: false }, lang);
    check(`entry (${lang}): when the Shop is not available there is no link, only the explanation`, !closed.includes("/dashboard/shop") && closed.includes(c.unavailable) && closed.includes(c.subtitle));
  }
  for (const f of [path.join(SRC, "components/church/store/ChurchStoreEntry.tsx")]) {
    const problems = sourceProblems(f);
    check("ChurchStoreEntry: no hard-coded text, storage, markup injection, service client, untyped button or unnamed field", problems.length === 0, problems.join(" || "));
  }
}

// ---------------------------------------------------------------- 3. the page is owner-only and adds no store of its own
{
  const page = noComments(read("src/app/dashboard/church/store/page.tsx"));
  check("the page resolves the actor on the server", /resolveChurchActor/.test(page));
  check("only the church owner gets the screen; everyone else gets NoAccess", /actor\.kind !== "owner"/.test(page) && /NoAccess section="store"/.test(page));
  check("the Shop link is offered only when the Shop is available (the dashboard menu's own test)", /shopIsVisibleFor/.test(page) && /shopAvailable=\{shopAvailable\}/.test(page));
  check("the page reads one profile row and writes nothing", !/\.(insert|update|delete|upsert)\(/.test(page) && !/createAdminClient|rpc\(/.test(page));
  const entry = noComments(read("src/components/church/store/ChurchStoreEntry.tsx"));
  check("the screen has no fetch, no form and no payment, order or product code", !/fetch\(|churchApi|<form|payment|checkout|product_orders|price/i.test(entry));
  check("there is no /api/church/store route (the Shop's own routes are used as they are)", !fs.existsSync(path.join(SRC, "app/api/church/store")));
  const shell = html(component("components/church/people/ChurchShell.tsx"), { caps: PERM.churchCapabilities(PERM.CHURCH_PERMISSIONS), isOwner: false, children: null }, "en");
  check("the Store tab is never shown to a non-owner, even holding every church permission", !shell.includes('href="/dashboard/church/store"'));
  check("the Store tab is shown to the owner", html(component("components/church/people/ChurchShell.tsx"), { caps: PERM.churchCapabilities([]), isOwner: true, children: null }, "en").includes('href="/dashboard/church/store"'));
  check("no church permission string exists for the store (it needs none: owner only)", !PERM.CHURCH_PERMISSIONS.some((p) => /store|shop/i.test(p)));
}

// ---------------------------------------------------------------- 4. the public label and order are intact
{
  const categories = read("src/lib/categories.ts");
  const i = categories.indexOf("church_ministries");
  check("the church category still labels its catalogue 'Church Store' / 'Boutique de l'église'", /catalogLabel: \{ en: "Church Store", fr: "Boutique de l'église" \}/.test(categories.slice(categories.indexOf("id: \"church_ministries\""))) && i > 0);
  const order = jiti(path.join(SRC, "lib/sectionOrder.ts"));
  const text = read("src/lib/sectionOrder.ts");
  check("the church page order still puts the catalogue (the Church Store) after events and before links", /church_ministries: \["events", "catalog", "links", "about"\]/.test(text));
  const pp = jiti(path.join(SRC, "lib/church/publicPage.ts"));
  check("church_store is a live public module, in its planned place between music and links", pp.CHURCH_LIVE_MODULES.includes("church_store") && pp.CHURCH_MODULE_ORDER.indexOf("church_music") < pp.CHURCH_MODULE_ORDER.indexOf("church_store") && pp.CHURCH_MODULE_ORDER.indexOf("church_store") < pp.CHURCH_MODULE_ORDER.indexOf("links"));
  check("order helper still loads", typeof order === "object");
}

// ---------------------------------------------------------------- 5. nothing else changed: no database, no commerce code
{
  const migrations = fs.readdirSync(path.join(REPO, "supabase/migrations"));
  check("no migration or support script exists for a church store", !migrations.some((f) => /church_store|church-store/i.test(f)) && !fs.readdirSync(path.join(REPO, "supabase/support")).some((f) => /church_store|church-store/i.test(f)));
  const allSql = migrations.filter((f) => /^202[67]-1[2]|^2027/.test(f)).map((f) => read(`supabase/migrations/${f}`)).join("\n");
  check("no church migration creates a store, product, order or payment table", !/create table (if not exists )?public\.(church_)?(store|shop|product|order|payment)/i.test(allSql));
  let changed = [];
  try {
    const sh = (...a) => execFileSync("git", a, { cwd: REPO, encoding: "utf8" });
    changed = [...sh("diff", "--name-only").split("\n"), ...sh("ls-files", "--others", "--exclude-standard").split("\n")].map((s) => s.trim()).filter(Boolean);
  } catch { /* not a git checkout: the check below is skipped */ }
  const commerce = changed.filter((f) => /(^|\/)(shop|shopAuth|productCheckout|product-checkout|checkout|payments?|fapshi|orders?|products?)([^a-z]|$)/i.test(f) && !/^scripts\/tests\//.test(f) && !/church/i.test(f));
  check("no existing shop, product, order, checkout or payment file is modified or added by this work", commerce.length === 0, commerce.join(", "));
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
