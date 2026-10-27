// Churches & Ministries expansion, Phase 3: what the PUBLIC pages show of the church's group pages (Men, Women, Youths, Children) and of the Pastors page. Pure helpers plus fail-safe loaders. No React.
//
// Only fields a church chose to publish are ever selected (never an audit column or the private roster link: no API role can read them). The database already returns only published rows of a published
// church; this file re-checks that on what it receives and accepts a picture only when it is an address in this platform's own storage (lib/church/images.ts). A public group lists NO member and shows
// no count; the Children group has no captions. Any failure while loading gives an empty result: a church page can never break because of this feature.

import { safeChurchImageUrl } from "../images";
import { PUBLIC_GROUP_KINDS, isPublicGroupKind, type PublicGroupKind } from "../pubgroups/kinds";
import { loadGroupAnnouncements, type PublicAnnouncement } from "./events";

export interface PublicGroup {
  id: string;
  kind: PublicGroupKind;
  leader_name: string | null;
  leader_photo_url: string | null;
  description_en: string | null;
  description_fr: string | null;
}
export interface PublicGroupPhoto {
  id: string;
  image_url: string;
  caption_en: string | null;
  caption_fr: string | null;
}
export interface PublicPastor {
  id: string;
  name: string;
  photo_url: string | null;
  word_en: string | null;
  word_fr: string | null;
  bio_en: string | null;
  bio_fr: string | null;
}
export interface PublicAbout {
  vision_en: string | null;
  vision_fr: string | null;
  mission_en: string | null;
  mission_fr: string | null;
}
export interface PublicGroupPage {
  group: PublicGroup;
  photos: PublicGroupPhoto[];
  announcements: PublicAnnouncement[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (v: unknown, max: number): string | null => (typeof v === "string" && v.trim() !== "" ? v.slice(0, max) : null);

export const GROUP_COLUMNS = "id, kind, leader_name, leader_photo_url, description_en, description_fr";
export const PHOTO_COLUMNS = "id, image_url, caption_en, caption_fr, sort_order";
export const PASTOR_COLUMNS = "id, name, photo_url, word_en, word_fr, bio_en, bio_fr, sort_order";
export const ABOUT_COLUMNS = "vision_en, vision_fr, mission_en, mission_fr";

/** The published groups, in the fixed order Men, Women, Youths, Children. A row with an unknown kind or id is dropped. */
export function shapePublicGroups(rows: unknown): PublicGroup[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicGroup[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !UUID.test(r.id) || !isPublicGroupKind(r.kind)) continue;
    if (r.is_published !== undefined && r.is_published !== true) continue; // defence in depth: a hidden group is never shown
    out.push({
      id: r.id,
      kind: r.kind,
      leader_name: text(r.leader_name, 80),
      leader_photo_url: safeChurchImageUrl(r.leader_photo_url),
      description_en: text(r.description_en, 600),
      description_fr: text(r.description_fr, 600),
    });
  }
  return out.sort((a, b) => PUBLIC_GROUP_KINDS.indexOf(a.kind) - PUBLIC_GROUP_KINDS.indexOf(b.kind));
}

/** The photos of a group, in the church's order. A photo whose address is not one this platform stores is dropped. The Children group never carries a caption, whatever the row says. */
export function shapeGroupPhotos(rows: unknown, kind: PublicGroupKind): PublicGroupPhoto[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicGroupPhoto[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !UUID.test(r.id)) continue;
    const image = safeChurchImageUrl(r.image_url);
    if (!image) continue;
    const children = kind === "children";
    out.push({ id: r.id, image_url: image, caption_en: children ? null : text(r.caption_en, 160), caption_fr: children ? null : text(r.caption_fr, 160) });
  }
  return out.slice(0, 12);
}

export function shapePublicPastors(rows: unknown): PublicPastor[] {
  if (!Array.isArray(rows)) return [];
  const out: PublicPastor[] = [];
  for (const r of rows as Record<string, unknown>[]) {
    if (!r || typeof r !== "object" || typeof r.id !== "string" || !UUID.test(r.id)) continue;
    if (r.is_published !== undefined && r.is_published !== true) continue;
    const name = text(r.name, 80);
    if (!name) continue;
    out.push({ id: r.id, name, photo_url: safeChurchImageUrl(r.photo_url), word_en: text(r.word_en, 300), word_fr: text(r.word_fr, 300), bio_en: text(r.bio_en, 3000), bio_fr: text(r.bio_fr, 3000) });
  }
  return out.slice(0, 12);
}

export function shapePublicAbout(row: unknown): PublicAbout | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (r.is_published !== undefined && r.is_published !== true) return null;
  const a: PublicAbout = { vision_en: text(r.vision_en, 1500), vision_fr: text(r.vision_fr, 1500), mission_en: text(r.mission_en, 1500), mission_fr: text(r.mission_fr, 1500) };
  return a.vision_en || a.vision_fr || a.mission_en || a.mission_fr ? a : null;
}

type Reader = { from(table: string): any };

/** The published group pages of one church. FAIL-SAFE: any error (including a database that has not got the tables yet) gives []. */
export async function loadPublicGroups(supabase: Reader, profileId: string): Promise<PublicGroup[]> {
  try {
    const { data, error } = await supabase.from("church_public_groups").select(GROUP_COLUMNS).eq("profile_id", profileId).eq("is_published", true).limit(PUBLIC_GROUP_KINDS.length);
    if (error) return [];
    return shapePublicGroups(data);
  } catch {
    return [];
  }
}

/** One group page: the group, its photos and its announcements. null when the group is not public (the page then answers 404, the same as for a church with no such page). */
export async function loadPublicGroupPage(supabase: Reader, profileId: string, kind: string, now: number = Date.now()): Promise<PublicGroupPage | null> {
  try {
    if (!isPublicGroupKind(kind)) return null;
    const { data, error } = await supabase.from("church_public_groups").select(GROUP_COLUMNS).eq("profile_id", profileId).eq("kind", kind).eq("is_published", true).limit(1);
    if (error) return null;
    const group = shapePublicGroups(data)[0];
    if (!group) return null;
    const [photos, announcements] = await Promise.all([
      supabase
        .from("church_group_photos")
        .select(PHOTO_COLUMNS)
        .eq("profile_id", profileId)
        .eq("public_group_id", group.id)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true })
        .limit(12)
        .then((r: { data: unknown; error: unknown }) => (r.error ? [] : shapeGroupPhotos(r.data, group.kind)), () => []),
      loadGroupAnnouncements(supabase, profileId, group.id, now),
    ]);
    return { group, photos, announcements };
  } catch {
    return null;
  }
}

/** The published pastors and the church's vision and mission. FAIL-SAFE: each part gives [] / null on any error. */
export async function loadPublicPastors(supabase: Reader, profileId: string): Promise<{ pastors: PublicPastor[]; about: PublicAbout | null }> {
  try {
    return await loadPastorsUnsafe(supabase, profileId);
  } catch {
    return { pastors: [], about: null };
  }
}

async function loadPastorsUnsafe(supabase: Reader, profileId: string): Promise<{ pastors: PublicPastor[]; about: PublicAbout | null }> {
  const pastors = await Promise.resolve(supabase.from("church_pastors").select(PASTOR_COLUMNS).eq("profile_id", profileId).eq("is_published", true).order("sort_order", { ascending: true }).order("created_at", { ascending: true }).limit(12))
    .then((r: { data: unknown; error: unknown }) => (r.error ? [] : shapePublicPastors(r.data)), () => []);
  const about = await Promise.resolve(supabase.from("church_about").select(`${ABOUT_COLUMNS}, is_published`).eq("profile_id", profileId).eq("is_published", true).maybeSingle())
    .then((r: { data: unknown; error: unknown }) => (r.error ? null : shapePublicAbout(r.data)), () => null);
  return { pastors, about };
}
