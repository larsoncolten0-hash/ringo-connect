import type { ChurchActor } from "../actor";
import { todayDouala } from "../handlers";
import { translations } from "@/lib/i18n/translations";
import { buildListPdf, type PdfListInput } from "./pdf";

// Churches & Ministries expansion, Phase 4: the PDF lists of a church (members, leadership, groups) with their counts. Pure of I/O except the reads below, which go through the signed-in person's OWN
// session, so row-level security decides which rows exist for them (a person without children rights simply does not receive the children, and the groups list says children are not counted).
//
// WHO: a downloaded list is a copy of personal information that leaves the app, so it needs the export permission (church.export, owner-only to grant) AND the permission to see that very list
// (members.view, leadership.view, groups.view). A group leader (not staff) never gets a list. The file name carries the church and the date, never a person. Nothing about a person is logged.

export const LIST_KINDS = ["members", "leadership", "groups"] as const;
export type ListKind = (typeof LIST_KINDS)[number];
export const isListKind = (v: unknown): v is ListKind => typeof v === "string" && (LIST_KINDS as readonly string[]).includes(v);
export const LIST_ROW_LIMIT = 5000;

export type ListResult = { ok: true; bytes: Uint8Array; filename: string; rows: number } | { ok: false; status: number; code: string };
type Row = Record<string, any>;
type Lang = "en" | "fr";

const dayLabel = (iso: string, lang: Lang): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return new Intl.DateTimeFormat(lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
};
const slug = (s: string): string => (s.normalize("NFKD").replace(/[^\x20-\x7e]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "church").toLowerCase();
const fail = (status: number, code: string): ListResult => ({ ok: false, status, code });

async function readAll(a: ChurchActor, make: (from: number, to: number) => any): Promise<{ rows: Row[]; error: unknown }> {
  const rows: Row[] = [];
  for (let from = 0; from < LIST_ROW_LIMIT; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) return { rows, error };
    const page = (data as Row[]) || [];
    rows.push(...page);
    if (page.length < 1000) break;
  }
  return { rows: rows.slice(0, LIST_ROW_LIMIT), error: null };
}

export async function buildChurchList(a: ChurchActor, kind: string, langIn: string, now: number = Date.now()): Promise<ListResult> {
  if (!isListKind(kind)) return fail(404, "not_found");
  const lang: Lang = langIn === "fr" ? "fr" : "en";
  if (a.kind === "leader" || !a.caps.exportLists) return fail(403, "forbidden");
  const allowed = kind === "members" ? a.caps.viewMembers : kind === "leadership" ? a.caps.viewLeadership : a.caps.viewGroups;
  if (!allowed) return fail(403, "forbidden");

  const x = translations[lang].churchExpansion.members.pdf;
  const today = todayDouala(now);
  const { data: church, error: ce } = await a.supabase.from("profiles").select("name, username").eq("id", a.profileId).maybeSingle();
  if (ce) return fail(500, "server_error");
  const churchName = String((church as Row | null)?.name || (church as Row | null)?.username || "");
  const base = { church: churchName, dateLabel: dayLabel(today, lang), footerNote: x.confidential, pageLabel: x.page };
  let input: PdfListInput;

  if (kind === "members") {
    const { rows, error } = await readAll(a, (f, t) =>
      a.supabase.from("church_members").select("id, full_name, age_group, phone, email, created_at").eq("profile_id", a.profileId).eq("status", "active").order("full_name", { ascending: true }).order("id", { ascending: true }).range(f, t)
    );
    if (error) return fail(500, "server_error");
    const n = (g: string) => rows.filter((r) => r.age_group === g).length;
    const summary: Array<[string, string]> = [[x.members.total, String(rows.length)], [x.members.adults, String(n("adult"))], [x.members.youth, String(n("youth"))]];
    if (a.caps.viewChildren || a.caps.manageChildren) summary.push([x.members.children, String(n("child"))]);
    const ages = translations[lang].churchExpansion.members.list.ages as Record<string, string>;
    input = {
      ...base,
      title: x.members.title,
      summary,
      columns: [{ header: x.members.name, weight: 3 }, { header: x.members.age, weight: 1.2 }, { header: x.members.phone, weight: 1.8 }, { header: x.members.email, weight: 3 }, { header: x.members.since, weight: 1.6 }],
      rows: rows.map((r) => [r.full_name, ages[r.age_group] ?? r.age_group, r.phone ?? "", r.email ?? "", dayLabel(String(r.created_at ?? "").slice(0, 10), lang)]),
      emptyText: x.members.empty,
    };
  } else if (kind === "leadership") {
    const { rows, error } = await readAll(a, (f, t) =>
      a.supabase.from("church_leadership").select("member_id, title, started_on, ended_on").eq("profile_id", a.profileId).or(`ended_on.is.null,ended_on.gt.${today}`).order("title", { ascending: true }).order("created_at", { ascending: true }).range(f, t)
    );
    if (error) return fail(500, "server_error");
    const names = new Map<string, string>();
    const ids = Array.from(new Set(rows.map((r) => r.member_id)));
    for (let i = 0; i < ids.length; i += 100) {
      const { data, error: e2 } = await a.supabase.from("church_members").select("id, full_name").eq("profile_id", a.profileId).in("id", ids.slice(i, i + 100));
      if (e2) return fail(500, "server_error");
      for (const m of (data as Row[]) || []) names.set(m.id, m.full_name);
    }
    const list = rows.map((r) => ({ name: names.get(r.member_id) ?? "", title: r.title, since: r.started_on ?? "" })).sort((p, q) => p.name.localeCompare(q.name) || p.title.localeCompare(q.title));
    input = {
      ...base,
      title: x.leadership.title,
      summary: [[x.leadership.total, String(list.length)]],
      columns: [{ header: x.leadership.name, weight: 3 }, { header: x.leadership.role, weight: 3 }, { header: x.leadership.since, weight: 1.6 }],
      rows: list.map((r) => [r.name, r.title, r.since ? dayLabel(r.since, lang) : ""]),
      emptyText: x.leadership.empty,
    };
  } else {
    const gr = await a.supabase.from("church_groups").select("id, kind, name").eq("profile_id", a.profileId).eq("status", "active").order("name", { ascending: true }).limit(500);
    if (gr.error) return fail(500, "server_error");
    const groups = (gr.data as Row[]) || [];
    const gm = await readAll(a, (f, t) => a.supabase.from("church_group_members").select("group_id, member_id, role").eq("profile_id", a.profileId).order("id", { ascending: true }).range(f, t));
    if (gm.error) return fail(500, "server_error");
    const leaderIds = Array.from(new Set(gm.rows.filter((r) => r.role === "leader" || r.role === "assistant").map((r) => r.member_id)));
    const names = new Map<string, string>();
    for (let i = 0; i < leaderIds.length; i += 100) {
      const { data, error: e2 } = await a.supabase.from("church_members").select("id, full_name").eq("profile_id", a.profileId).in("id", leaderIds.slice(i, i + 100));
      if (e2) return fail(500, "server_error");
      for (const m of (data as Row[]) || []) names.set(m.id, m.full_name);
    }
    const lines = groups.map((g) => {
      const inGroup = gm.rows.filter((r) => r.group_id === g.id);
      const leaders = inGroup.filter((r) => r.role === "leader").map((r) => names.get(r.member_id)).filter(Boolean) as string[];
      return { name: g.name as string, type: g.kind === "department" ? x.groups.department : x.groups.group, leaders: leaders.join(", "), count: inGroup.length };
    });
    input = {
      ...base,
      title: x.groups.title,
      summary: [[x.groups.total, String(lines.length)], [x.groups.people, String(lines.reduce((s, l) => s + l.count, 0))], [x.groups.childrenNote, ""]],
      columns: [{ header: x.groups.name, weight: 3.2 }, { header: x.groups.type, weight: 1.4 }, { header: x.groups.leaders, weight: 3 }, { header: x.groups.count, weight: 1, align: "right" }],
      rows: lines.map((l) => [l.name, l.type, l.leaders, String(l.count)]),
      emptyText: x.groups.empty,
    };
  }

  const bytes = await buildListPdf(input);
  return { ok: true, bytes, filename: `${slug(churchName)}-${kind}-${today}.pdf`, rows: input.rows.length };
}
