import { createAdminClient } from "@/lib/supabase/server";
import { DEFAULT_BRANDING, type BrandingSettings } from "@/lib/brandingDefaults";

export type { BrandingSettings };

// The one place platform branding is fetched from — every server
// component/route that used to hardcode "Ringo Connect" / "/logo.png" /
// the indigo brand color now reads it from here instead (root layout's
// <title>/favicon/CSS variable, DashboardShell, AdminShell, the landing
// page, and the dashboard/admin PWA manifests). AuthShell is the one
// exception — it's rendered from Client Components, so it can't import
// this file at all (it transitively pulls in next/headers) and instead
// fetches /api/branding client-side, starting from the same
// DEFAULT_BRANDING this file re-exports from brandingDefaults.ts. Never
// edit branding values in the components themselves — change them in
// branding_settings via /admin/branding, or in DEFAULT_BRANDING for the
// fallback.
//
// DEFAULT_BRANDING matches exactly what was hardcoded everywhere before
// this table existed, so a database that hasn't run
// 2026-09-29_branding_settings.sql yet (or a row with some columns still
// null) never breaks anything — every field falls back to today's real
// value, not a placeholder.
export async function getBrandingSettings(): Promise<BrandingSettings> {
  const admin = createAdminClient();
  const { data } = await admin.from("branding_settings").select("*").limit(1).maybeSingle();

  return {
    appName: data?.app_name || DEFAULT_BRANDING.appName,
    shortName: data?.short_name || DEFAULT_BRANDING.shortName,
    logoUrl: data?.logo_url || DEFAULT_BRANDING.logoUrl,
    faviconUrl: data?.favicon_url || DEFAULT_BRANDING.faviconUrl,
    primaryColor: data?.primary_color || DEFAULT_BRANDING.primaryColor,
    pwaThemeColor: data?.pwa_theme_color || DEFAULT_BRANDING.pwaThemeColor,
    pwaBackgroundColor: data?.pwa_background_color || DEFAULT_BRANDING.pwaBackgroundColor,
  };
}

export type BrandingPatch = Partial<{
  appName: string;
  shortName: string;
  logoUrl: string | null;
  faviconUrl: string | null;
  primaryColor: string;
  pwaThemeColor: string;
  pwaBackgroundColor: string;
}>;

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

/**
 * Updates branding settings. Only ever call this from an already
 * admin-verified API route (see src/lib/assertAdmin.ts) — this function
 * itself does not check permissions, matching updatePlatformSettings()'s
 * own posture (the service-role client it uses has no RLS to fall back
 * on for protection).
 */
export async function updateBrandingSettings(patch: BrandingPatch, updatedByUserId: string) {
  const admin = createAdminClient();
  const { data: existing } = await admin.from("branding_settings").select("id").limit(1).maybeSingle();
  if (!existing) throw new Error("branding_settings row not found — check the migration ran");

  const dbPatch: Record<string, any> = { updated_at: new Date().toISOString(), updated_by: updatedByUserId };

  if (patch.appName !== undefined) {
    if (!patch.appName.trim()) throw new Error("App name can't be empty.");
    dbPatch.app_name = patch.appName.trim().slice(0, 60);
  }
  if (patch.shortName !== undefined) {
    if (!patch.shortName.trim()) throw new Error("Short name can't be empty.");
    dbPatch.short_name = patch.shortName.trim().slice(0, 30);
  }
  // Logo/favicon: null explicitly clears back to the bundled default
  // (see DEFAULT_BRANDING) — undefined means "leave this field alone."
  if (patch.logoUrl !== undefined) dbPatch.logo_url = patch.logoUrl;
  if (patch.faviconUrl !== undefined) dbPatch.favicon_url = patch.faviconUrl;

  for (const [key, column] of [
    ["primaryColor", "primary_color"],
    ["pwaThemeColor", "pwa_theme_color"],
    ["pwaBackgroundColor", "pwa_background_color"],
  ] as const) {
    const value = patch[key];
    if (value === undefined) continue;
    if (!HEX_COLOR.test(value)) throw new Error(`${column.replace(/_/g, " ")} must be a hex color like #4F46E5.`);
    dbPatch[column] = value;
  }

  const { error } = await admin.from("branding_settings").update(dbPatch).eq("id", existing.id);
  if (error) throw new Error(error.message);
}
