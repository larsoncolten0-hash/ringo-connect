// Customer marketing consent (Phase 3A): the My Ringo consent switches, checked OFFLINE (static render and source checks, no browser, no network).
//   * English and French have the same keys, every sentence is filled in, French is French;
//   * the component has no hard-coded text, no direct database client, no storage or markup injection, and every switch has an accessible name;
//   * it is mounted on the My Ringo connections screen, talks only to /api/customer/consent, and offers email and push only (no WhatsApp);
//   * the intro tells the customer that everything is off until they turn it on and that order/booking/reward notifications are separate.
//   Run:  node scripts/tests/customerConsentUi.test.mjs
import path from "path";
import { SRC, read, noComments, translations, walkDictionary, sampleArgs, sourceProblems, component, html } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };

{
  const en = translations.en.myRingo.connections.consent, fr = translations.fr.myRingo.connections.consent;
  const w = walkDictionary(en, fr, "consent");
  check("consent: EN and FR have the same keys and types", w.shape.length === 0, w.shape.join(" ; "));
  check("consent: no sentence is empty", w.strings.every(([, a, b]) => a.trim() !== "" && b.trim() !== ""));
  check("consent: French is French (every label differs from English)", ["title", "intro", "emailLabel", "pushLabel", "failed", "unavailable", "savedOn", "savedOff"].every((k) => en[k] !== fr[k]));
  const keys = ["title", "intro", "loading", "empty", "emailLabel", "emailHint", "pushLabel", "pushHint", "pendingEmail", "pendingApply", "unsubscribed", "removed", "savedOn", "savedOff", "failed", "unavailable", "notConnected"];
  check("consent: every state the screen can show has a sentence in both languages", keys.every((k) => en[k] && fr[k]));
  check("the intro says everything is off until turned on, can be changed any time, and that order/booking/reward notifications are separate", /off until you turn it on/i.test(en.intro) && /change your mind/i.test(en.intro) && /Order, booking, ticket and reward notifications are separate/.test(en.intro) && /désactivé/.test(fr.intro) && /distinctes/.test(fr.intro));
  check("the dictionary offers no WhatsApp option", !/whatsapp/i.test(JSON.stringify(en)) && !/whatsapp/i.test(JSON.stringify(fr)));
}
{
  const file = path.join(SRC, "components/my-ringo/ConsentSection.tsx");
  const problems = sourceProblems(file);
  check("ConsentSection: no hard-coded text, no database client, no storage, typed fields with names", problems.length === 0, problems.join(" ; "));
  const src = noComments(read("src/components/my-ringo/ConsentSection.tsx"));
  check("it talks only to /api/customer/consent and offers email and push only", /\/api\/customer\/consent/.test(src) && !/whatsapp/i.test(src) && (src.match(/\/api\//g) || []).length === 2);
  check("a switch only changes after the server confirmed it (the state is replaced from the response)", /res\.data\?\.item/.test(src) && /setItems/.test(src));
  check("a switch is OFF unless the server says the decision exists (state !== \"off\")", /checked=\{i\.email\.state !== "off"\}/.test(src) && /checked=\{i\.push\.state !== "off"\}/.test(src));
  check("it never sends the customer id (the server takes it from the cookie)", !/customer_id|customerId/.test(src));
  const views = read("src/components/my-ringo/MyRingoViews.tsx");
  check("it is mounted on the connections screen, only when there is a connection", /import ConsentSection from "\.\/ConsentSection"/.test(views) && /list\.length > 0 && <ConsentSection/.test(views));
  const Comp = component("components/my-ringo/ConsentSection.tsx");
  const en = html(Comp, {}, "en"), fr = html(Comp, {}, "fr");
  check("it renders (loading state) in both languages without crashing", /Loading your choices/.test(en) && /Chargement de vos choix/.test(fr), en.slice(0, 200));
}
console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
