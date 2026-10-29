// Church public profile: Save Contact in the hero reuses the shared vCard builder and click handler, needs a usable number, is inert in the editor preview,
// and uses the existing bilingual label. Connect stays the single existing ConnectButton in the contact card.
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../../src/components/church/site/ChurchSiteView.tsx", import.meta.url), "utf8");
const en = readFileSync(new URL("../../src/lib/i18n/translations.en.ts", import.meta.url), "utf8");
const fr = readFileSync(new URL("../../src/lib/i18n/translations.fr.ts", import.meta.url), "utf8");

let pass = 0;
let fail = 0;
function check(name, ok) {
  if (ok) pass++;
  else {
    fail++;
    console.error("FAIL:", name);
  }
}

check("imports the shared vCard builder", /import \{ buildVCard, vCardFileName \} from "@\/lib\/vcard"/.test(src));
check("imports the shared click handler", /import \{ saveContactClick \} from "@\/components\/SaveContactButton"/.test(src));
check("vCard link only exists when a usable WhatsApp or phone number exists", /const vcardHref = wa \|\| phone \?/.test(src));
check("click goes through saveContactClick", /saveContactClick\(e, profile\)/.test(src));
check("preview is inert (no href, no download, click prevented)", /href=\{preview \? undefined : vcardHref\}/.test(src) && /download=\{preview \? undefined : vCardFileName\(profile\)\}/.test(src) && /preview \? e\.preventDefault\(\)/.test(src));
check("uses the existing profilePage label", /t\.profilePage\.saveContactButton/.test(src));
check("label exists in English and French", /saveContactButton: "Save contact"/.test(en) && /saveContactButton: "Enregistrer"/.test(fr));
check("Connect is still rendered exactly once", (src.match(/<ConnectButton /g) || []).length === 1);
check("Connect stays hidden from the owner of the page", /\{!isOwner && \([\s\S]{0,200}<ConnectButton /.test(src));

console.log(`${pass}/${pass + fail} church save-contact checks passed`);
process.exit(fail ? 1 : 0);
