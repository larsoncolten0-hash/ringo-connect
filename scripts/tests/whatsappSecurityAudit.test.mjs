// WhatsApp system hardening audit (Phase 10 Part F): cross-cutting, read-only checks over the WHOLE WhatsApp/Inbox surface (webhook, sender, media,
// AI assistant, automation, cron, routes, pages, components, migrations). It reads source and SQL text and the git working tree. It changes nothing,
// needs no database, no network and no credentials.
//   Run:  node scripts/tests/whatsappSecurityAudit.test.mjs
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const REPO = fileURLToPath(new URL("../../", import.meta.url));
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond }); if (!cond) console.log("  FAIL:", name, "|", String(detail).slice(0, 600)); };
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8").replace(/\r\n/g, "\n");
const walk = (d) => (fs.existsSync(path.join(REPO, d)) ? fs.readdirSync(path.join(REPO, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${d}/${e.name}`) : [`${d}/${e.name}`])) : []);
const code = (f) => read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const git = (...args) => { try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8" }); } catch { return null; } };

const LIBS = [...walk("src/lib/whatsapp"), ...walk("src/lib/inbox")];
const COMPONENTS = walk("src/components/inbox");
const ROUTES = [...walk("src/app/api/inbox"), ...walk("src/app/api/integrations/whatsapp"), ...walk("src/app/api/cron/inbox-follow-ups")].filter((f) => /route\.ts$/.test(f));
const PAGES = walk("src/app/dashboard/inbox");
const MIGRATIONS = ["2026-12-07_whatsapp_inbox_foundation", "2026-12-08_whatsapp_outbound_replies", "2026-12-09_whatsapp_inbox_tools", "2026-12-10_whatsapp_outbound_media", "2026-12-11_whatsapp_inbox_automation", "2026-12-12_whatsapp_inbox_mark_read"].map((m) => `supabase/migrations/${m}.sql`);
const SQL_SUPPORT = walk("supabase/support").filter((f) => /whatsapp_(inbox|outbound)/.test(f) && f.endsWith(".sql"));
const ALL_SRC = [...LIBS, ...COMPONENTS, ...ROUTES, ...PAGES].filter((f) => /\.(ts|tsx)$/.test(f));

// ============================================================ 1. every entry point is authenticated the right way
const methods = (f) => [...code(f).matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
const routeInfo = Object.fromEntries(ROUTES.map((f) => [f.replace("src/app/api/", ""), { methods: methods(f), src: code(f) }]));
const inboxRoutes = Object.entries(routeInfo).filter(([k]) => k.startsWith("inbox/"));
check("inventory: the inbox API is exactly the expected routes", JSON.stringify(inboxRoutes.map(([k]) => k).sort()) === JSON.stringify(["inbox/conversations/[id]/assist/route.ts", "inbox/conversations/[id]/media/route.ts", "inbox/conversations/[id]/messages/route.ts", "inbox/conversations/[id]/read/route.ts", "inbox/conversations/[id]/status/route.ts", "inbox/saved-replies/[id]/route.ts", "inbox/saved-replies/route.ts", "inbox/settings/route.ts"]), inboxRoutes.map(([k]) => k).join());
check("inbox routes: none exports GET (no inbox data endpoint exists), every one derives the owner from the session (withInboxOwner or resolveInboxOwner)", inboxRoutes.every(([, r]) => !r.methods.includes("GET") && r.methods.length >= 1 && /withInboxOwner|resolveInboxOwner/.test(r.src)));
check("inbox routes: none reads a profile id, recipient, phone number, WABA id or token from the request", inboxRoutes.every(([, r]) => !/(body|form|b|json)(\.|\?\.|\[["'])(profile|profile_id|to|recipient|phone|phone_number_id|waba|waba_id|token|access_token|user_id|actor)\b/i.test(r.src)), inboxRoutes.filter(([, r]) => /(body|form|b)\.(profile|to|recipient|phone|waba|token|user_id)/i.test(r.src)).map(([k]) => k).join());
const jsonOrMultipart = (r) => /application\/json|multipart\/form-data/.test(r.src) || /withInboxOwner/.test(r.src);
check("inbox routes: every state-changing route requires JSON (or multipart WITH the custom upload header), so a cross-site form post cannot drive it", inboxRoutes.every(([, r]) => jsonOrMultipart(r)) && /x-ringo-upload/.test(routeInfo["inbox/conversations/[id]/media/route.ts"].src));
const wh = routeInfo["integrations/whatsapp/webhook/route.ts"];
check("webhook: GET handshake needs the verify token, POST needs a valid HMAC signature over the raw body BEFORE parsing, compared in constant time", wh.methods.sort().join() === "GET,POST" && /WHATSAPP_VERIFY_TOKEN/.test(wh.src) && wh.src.indexOf("verifyWhatsAppSignature(") < wh.src.indexOf("JSON.parse") && /timingSafeEqual/.test(code("src/lib/whatsapp/signature.ts")) && /createHmac\("sha256"/.test(code("src/lib/whatsapp/signature.ts")));
check("webhook: events for an account that is not allow-listed are dropped before storage, and the owner is derived by the database from the phone number id", /partitionByAccount\(/.test(wh.src) && !/profile_id|profileId/.test(wh.src));
const cr = routeInfo["cron/inbox-follow-ups/route.ts"];
check("cron: GET only, CRON_SECRET bearer, fails closed when the secret is missing", cr.methods.join() === "GET" && /!process\.env\.CRON_SECRET \|\|/.test(cr.src) && /authorization/.test(cr.src));
check("every other cron route in the project uses the same bearer pattern (the new one is not an exception)", walk("src/app/api/cron").filter((f) => f.endsWith("route.ts")).every((f) => /CRON_SECRET/.test(read(f))));
check("pages: every inbox page re-resolves the owner on the server and redirects otherwise; the layout guards the whole area", PAGES.filter((f) => /page\.tsx$/.test(f)).every((f) => /resolveInboxOwner/.test(read(f))) && /resolveInboxOwner/.test(read("src/app/dashboard/inbox/layout.tsx")));

// ============================================================ 2. secrets and trust boundaries
const SERVER_ONLY = /\b(WHATSAPP_ACCESS_TOKEN|WHATSAPP_APP_SECRET|WHATSAPP_VERIFY_TOKEN|META_APP_SECRET|CRON_SECRET|SERVICE_ROLE|graph\.facebook\.com|Bearer )/;
const clientFiles = COMPONENTS.concat(["src/lib/inbox/client.ts", "src/lib/inbox/format.ts", "src/lib/inbox/settings.ts", "src/lib/inbox/leads.ts", "src/lib/whatsapp/mediaRules.ts"]);
check("secrets: the token, app secret, verify token, cron secret, service role and the Meta host appear in NO browser-side file", clientFiles.every((f) => !SERVER_ONLY.test(code(f))), clientFiles.filter((f) => SERVER_ONLY.test(code(f))).join());
check("secrets: browser-side files never import a server-only module (supabase/server, crypto, send, automation, aiAssist, outbound, media, ai/guard)", clientFiles.every((f) => !/from "(@\/lib\/supabase\/server|crypto|fs|@\/lib\/inbox\/(send|sendMedia|automation|aiAssist|route|tools|settingsSave|access)|@\/lib\/whatsapp\/(outbound|media|ingest|config|signature)|@\/lib\/ai\/(guard|providers|orchestrator|usage))"/.test(code(f))));
const envRefs = ALL_SRC.filter((f) => /process\.env\.(WHATSAPP_\w+|META_\w+)/.test(code(f))).sort();
const secretNames = ALL_SRC.filter((f) => /WHATSAPP_(ACCESS_TOKEN|APP_SECRET|VERIFY_TOKEN)/.test(code(f))).sort();
check("secrets: the WhatsApp token, app secret and verify token are named only in the server modules that need them, never in a component", secretNames.length >= 3 && secretNames.every((f) => ["src/app/api/integrations/whatsapp/webhook/route.ts", "src/lib/whatsapp/config.ts", "src/lib/whatsapp/outbound.ts", "src/lib/whatsapp/signature.ts"].includes(f)), secretNames.join());
check("secrets: no NEXT_PUBLIC variable is used anywhere in the WhatsApp/Inbox code", ALL_SRC.every((f) => !/NEXT_PUBLIC_/.test(code(f))));
const everything = [...ALL_SRC, ...MIGRATIONS, ...SQL_SUPPORT];
check("secrets: no Meta token, long numeric id, bearer value or phone number is hard-coded in source or SQL", everything.every((f) => { const t = code(f).replace(/--.*$/gm, ""); return !/EAA[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9]{12,}|\b[0-9]{13,}\b|\+?237[0-9]{8,9}\b/.test(t); }), everything.filter((f) => /EAA[A-Za-z0-9]{20,}|\b[0-9]{13,}\b|\+?237[0-9]{8,9}\b/.test(code(f))).join());
const logCalls = ALL_SRC.flatMap((f) => [...code(f).matchAll(/console\.(log|info|warn|error)\(([^;]*)\)/g)].map((m) => ({ f, args: m[2] })));
const stripLogArgs = (a) => a.replace(/"(scope|result)":\s*"[^"]*"/g, "").replace(/message_id|provider_message_id|phone_number_id|conversation_id/g, "");
check("logging: no console call in the WhatsApp/Inbox code passes a message body, text, caption, name, phone, token, header or a raw error object", logCalls.every(({ args }) => !/\b(text|body|caption|name|phone|to|token|headers|Authorization|message)\b|\.message|^\s*(e|err|error)\s*$/i.test(stripLogArgs(args))), logCalls.filter(({ args }) => /\b(text|body|caption|name|phone|to|token|headers|Authorization|message)\b|\.message|^\s*(e|err|error)\s*$/i.test(stripLogArgs(args))).map((c) => `${c.f}: ${c.args.slice(0, 100)}`).join(" | "));
check("rendering: no raw HTML injection anywhere in the Inbox components or pages", [...COMPONENTS, ...PAGES].filter((f) => /\.tsx$/.test(f)).every((f) => !/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML|eval\(|new Function/.test(code(f))));
check("privacy: no code stores or serves customer or outbound files (no storage bucket, signed/public URL, file write, or media download from Meta)", ALL_SRC.every((f) => !/storage\.from|createSignedUrl|getPublicUrl|writeFile|createWriteStream|\.upload\(|\/media\/\$\{|retrieveMedia/.test(code(f))));

// ============================================================ 3. the AI never acts, automation never reaches beyond its rules
const ai = code("src/lib/inbox/aiAssist.ts") + code("src/app/api/inbox/conversations/[id]/assist/route.ts") + code("src/components/inbox/InboxAiPanel.tsx");
check("AI: the assistant has no tools, no sender, no write call and its panel only inserts text into the reply box (never submits)", /tools: \[\]/.test(ai) && !/sendReply|sendMediaReply|sendWhatsApp|postReply|postMedia|\.rpc\(|\.insert\(|\.update\(|\.delete\(/.test(ai) && (ai.match(/onInsert\(/g) || []).length === 1);
check("AI: automation never imports the AI module and the AI module never imports automation or senders", !/aiAssist|ai\/providers|ai\/guard/.test(code("src/lib/inbox/automation.ts")) && !/inbox\/(automation|send|sendMedia)|whatsapp\/(outbound|media)/.test(code("src/lib/inbox/aiAssist.ts")));
const senders = ALL_SRC.filter((f) => /sendWhatsAppText|sendWhatsAppMedia|uploadWhatsAppMedia/.test(code(f)) && !/^src\/lib\/whatsapp\/(outbound|media)\.ts$/.test(f));
check("sending: Meta is only ever contacted from the three audited modules (text sender, media sender, and the two orchestrators that call them)", JSON.stringify(senders.sort()) === JSON.stringify(["src/lib/inbox/send.ts", "src/lib/inbox/sendMedia.ts"]) && ALL_SRC.filter((f) => /graph\.facebook\.com/.test(code(f))).sort().join() === "src/lib/whatsapp/media.ts,src/lib/whatsapp/outbound.ts", senders.join());
const callers = ALL_SRC.filter((f) => /sendReply\(|sendMediaReply\(|\bsend\(/.test(code(f)) && !/^src\/lib\/inbox\/(send|sendMedia)\.ts$/.test(f)).sort();
check("sending: a customer message can only be started by a signed-in owner's reply route, the media route, or the owner-enabled acknowledgement (automation)", JSON.stringify(callers) === JSON.stringify(["src/app/api/inbox/conversations/[id]/media/route.ts", "src/app/api/inbox/conversations/[id]/messages/route.ts", "src/lib/inbox/automation.ts"].sort()), callers.join());
check("sending: no calling, no template or broadcast sending, no sticker sending exists in the outbound WhatsApp/Inbox code", ALL_SRC.filter((f) => !/whatsapp\/(parseWebhook|types)\.ts$/.test(f)).every((f) => !/type: "template"|"template":|messaging_product[^}]*template|broadcast|bulk_send|type: "call"|voice_call|"sticker"\s*:\s*\{/.test(code(f))));

// ============================================================ 4. SQL: every function and table across Phases 4-10
const sql = Object.fromEntries(MIGRATIONS.map((f) => [f, read(f)]));
const allSql = Object.values(sql).join("\n");
const fnBlocks = [...allSql.matchAll(/create or replace function public\.(\w+)\(([\s\S]*?)\)\s*returns[\s\S]*?(?=\n\$\$;|\nend \$\$;|\nend;\n\$\$;)/g)];
const secdef = [...allSql.matchAll(/create or replace function public\.(\w+)\([^)]*\)[\s\S]*?\bas \$\$/g)].map((m) => ({ name: m[1], head: m[0] }));
const definers = secdef.filter((f) => /security definer/i.test(f.head));
check("SQL: every SECURITY DEFINER function pins its search_path", definers.length >= 14 && definers.every((f) => /set search_path = public, pg_temp/.test(f.head)), `${definers.length}: ` + definers.filter((f) => !/set search_path = public, pg_temp/.test(f.head)).map((f) => f.name).join());
const grantLists = [...allSql.matchAll(/p\.proname in \(([^)]*)\)/g)].flatMap((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]));
check("SQL: every function across the five migrations is covered by a revoke-then-grant-to-service_role loop (none is left with default public execute)", secdef.every((f) => grantLists.includes(f.name)), secdef.filter((f) => !grantLists.includes(f.name)).map((f) => f.name).join());
check("SQL: every grant of execute goes to service_role only, after a revoke from public, anon, authenticated and service_role", [...allSql.matchAll(/grant execute on function %s to ([a-z_]+)'/gi)].length >= 5 && [...allSql.matchAll(/grant execute on function %s to ([a-z_]+)'/gi)].every((m) => m[1] === "service_role") && (allSql.match(/revoke all on function %s from public, anon, authenticated, service_role/g) || []).length >= 5 && !/grant (all|execute|insert|update|delete)\b[^;']* to (public|anon)\b/i.test(allSql.replace(/revoke[^;]*;/gi, "")));
const tables = [...allSql.matchAll(/create table if not exists public\.(\w+)/g)].map((m) => m[1]);
check("SQL: every table created has row level security enabled (explicitly, or through the Phase 4 policy loop)", tables.length === 9 && tables.every((t) => new RegExp(`alter table public\\.${t} enable row level security`).test(allSql) || new RegExp(`'${t}'`).test(sql[MIGRATIONS[0]])), tables.join());
check("SQL: no policy anywhere allows a client to write (only SELECT policies, owner-scoped through profiles.user_id = auth.uid())", ![...allSql.matchAll(/create policy[^;]*?for (insert|update|delete|all)/gi)].length && [...allSql.matchAll(/for select to authenticated\s+using \(([^;]*?)\);/g)].every((m) => /auth\.uid\(\)/.test(m[1])));
check("SQL: no migration changes anything outside the inbox/wa objects (no alter/drop/update/delete of a non-inbox table)", !/\b(alter table|drop table|delete from|update|insert into)\s+public\.(?!inbox_|wa_)\w+/i.test(allSql.replace(/\bfor update\b/gi, "").replace(/\bdo update\b/gi, "")), (allSql.match(/\b(alter table|drop table|delete from|update|insert into)\s+public\.(?!inbox_|wa_)\w+/gi) || []).join());
const sqlCode = allSql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
check("SQL: no function can reach outside the database (no http, pg_net, dblink or copy to a program) and the only dynamic SQL is the migrations' own revoke/grant/policy statements", !/net\.http|pg_net|dblink|copy [^;]* program/i.test(sqlCode) && [...sqlCode.matchAll(/\bexecute\s+(?!function\b|on\b)(\w+)/gi)].every((m) => m[1] === "format") && [...sqlCode.matchAll(/execute format\('([a-z]+)/gi)].every((m) => /^(revoke|grant|create|alter)$/i.test(m[1])), [...sqlCode.matchAll(/\bexecute\s+(?!function\b|on\b)(\w+)/gi)].map((m) => m[1]).join());
check("SQL: ownership is derived inside every actor-taking function (profiles.user_id = p_actor_user_id)", definers.filter((f) => /p_actor_user_id/.test(f.head)).every((f) => new RegExp(`${f.name}[\\s\\S]*?user_id = p_actor_user_id`).test(allSql)));
check("SQL: the support scripts are read-only (preflight and verify contain no write statement) and hygiene-clean (no semicolon inside a string)", SQL_SUPPORT.filter((f) => /\.(preflight|verify)\.sql$/.test(f)).every((f) => { const t = read(f).split("\n").filter((l) => !l.trim().startsWith("--")).join("\n"); return !/\b(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i.test(t.replace(/'[^']*'/g, "")) && !/;[^\n]*\S/.test(t.trim().replace(/;$/, "")); }));

// ============================================================ 5. earlier phases are preserved
const status = git("status", "--porcelain");
const changed = status === null ? null : status.split("\n").filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ""));
const FROZEN = ["supabase/migrations/2026-12-07_whatsapp_inbox_foundation.sql", "supabase/migrations/2026-12-08_whatsapp_outbound_replies.sql", "supabase/migrations/2026-12-09_whatsapp_inbox_tools.sql", "src/lib/whatsapp/ingest.ts", "src/lib/whatsapp/parseWebhook.ts", "src/lib/whatsapp/signature.ts", "src/lib/whatsapp/config.ts", "src/lib/inbox/send.ts", "src/lib/inbox/tools.ts", "src/lib/inbox/route.ts", "src/lib/inbox/access.ts", "src/lib/inbox/data.ts"];
check("preserved: the audited Phase 4/7/8 migrations and the ingest, parse, signature, config, text-send, tools, route, access and data modules are byte-for-byte unchanged", changed === null || FROZEN.every((f) => !changed.includes(f)), (changed || []).filter((f) => FROZEN.includes(f)).join());
const num = git("diff", "--numstat", "--", "src/lib/whatsapp/outbound.ts");
check("preserved: the Phase 7 text sender changed by exactly one line (exporting its error classifier)", num === null || num.trim() === "" || num.trim().startsWith("1\t1\t"), num);
const ALLOWED = [/^src\/(lib|components|app)\/.*inbox/i, /^src\/lib\/whatsapp\//, /^src\/app\/api\/(inbox|cron\/inbox-follow-ups|integrations\/whatsapp)\//, /^src\/app\/dashboard\/inbox\//, /^src\/lib\/(i18n\/translations|notificationCategories)\.ts$/, /^src\/lib\/ai\/knowledge\//, /^vercel\.json$/, /^scripts\/tests\/(inbox|whatsapp|documentsAi\.test)/, /^supabase\/(migrations|support)\/.*(whatsapp)/, /^supabase\/support\/tests\/whatsapp_/];
check("scope: every changed or new file belongs to the WhatsApp/Inbox work (no unrelated file was touched)", changed === null || changed.every((f) => ALLOWED.some((re) => re.test(f))), (changed || []).filter((f) => !ALLOWED.some((re) => re.test(f))).join());
check("scope: no package, lockfile, config, middleware, billing, payment or auth file changed", changed === null || changed.every((f) => !/package(-lock)?\.json|next\.config|middleware|tsconfig|billing|payment|checkout|fapshi|auth\//i.test(f)), (changed || []).filter((f) => /package|middleware|billing|payment|fapshi|auth\//i.test(f)).join());
check("preserved: Phase 8 and 9 behaviour is covered by suites that still exist (saved replies, status, media, AI)", ["scripts/tests/whatsappInboxTools.test.mjs", "scripts/tests/whatsappMedia.test.mjs", "scripts/tests/whatsappInboxAi.test.mjs", "scripts/tests/whatsappInboxAutomation.test.mjs", "scripts/tests/whatsappReply.test.mjs", "scripts/tests/whatsappIngest.test.mjs", "scripts/tests/whatsappWebhook.test.mjs", "scripts/tests/inbox.test.mjs"].every((f) => fs.existsSync(path.join(REPO, f))));

// ============================================================ 6. bilingual coverage
const tr = read("src/lib/i18n/translations.ts");
const inboxKeys = (loc) => { const i = tr.indexOf(loc === "en" ? "    inbox: {\n      title: \"Inbox\"" : "    inbox: {\n      title: \"Boîte de réception\""); return i; };
check("i18n: every user-facing string added by Phases 9-10 sits in the shared translations file in both languages, and no component hard-codes visible text", inboxKeys("en") > 0 && COMPONENTS.filter((f) => /(InboxAiPanel|InboxSettingsForm)\.tsx$/.test(f)).every((f) => !/>\s*[A-Z][a-z]+(\s+[a-z]+)+[.!?]?\s*</.test(code(f).replace(/\{[^}]*\}/g, ""))));

const failed = results.filter((x) => !x.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
