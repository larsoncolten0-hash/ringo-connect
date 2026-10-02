// Frozen logos for issued documents. The business logo is the profile picture (profiles.avatar_url), but a document must NEVER depend on that live URL: before a
// document is issued, the server copies the picture into an IMMUTABLE store (bk_brand_assets: the bytes, content-addressed, append-only), and the document's seller
// snapshot then references the copy by id. Replacing or deleting the profile picture, or the file behind it, therefore cannot change an issued document.
//
//   syncBrandLogo   called just before a document is issued: makes the "current logo" copy match the profile picture (fetching it only from the project's own
//                   storage host, PNG/JPEG, size-capped). A failure never blocks issuing; the document is then simply issued without a logo.
//   loadBrandAsset  reads a frozen copy back for rendering (service role, scoped to the business that owns it). No network, no live URL.
import { fetchLogoBytes, sniffImage, type LogoBytes } from "./pdf/logo";

type SyncOwner = { profile: { id: string }; userId: string; supabase: any; admin: any };

const https = (u: unknown): u is string => typeof u === "string" && /^https:\/\/\S+$/.test(u) && u.length <= 500;

export async function syncBrandLogo(owner: SyncOwner, deps: { fetchLogo?: (url: string) => Promise<LogoBytes | null> } = {}): Promise<void> {
  try {
    const prof = await owner.supabase.from("profiles").select("avatar_url").eq("id", owner.profile.id).maybeSingle();
    if (prof.error) return;
    const avatar: string | null = https(prof.data?.avatar_url) ? prof.data.avatar_url : null;
    const cur = await owner.admin.from("bk_brand_logo_current").select("source_url, asset_id").eq("profile_id", owner.profile.id).maybeSingle();
    if (cur.error) return; // the table does not exist yet (Record Sale not installed): nothing to sync
    const inSync = (cur.data?.source_url ?? null) === avatar && (avatar === null || !!cur.data?.asset_id);
    if (inSync) return;
    const base = { p_profile_id: owner.profile.id, p_actor_user_id: owner.userId };
    if (avatar === null) {
      await owner.admin.rpc("doc_set_brand_logo", { ...base, p_source_url: null, p_content_type: null, p_b64: null });
      return;
    }
    const img = await (deps.fetchLogo ?? ((u: string) => fetchLogoBytes(u)))(avatar);
    if (!img) return; // could not read the picture: leave it as it was, the document is issued without a logo
    await owner.admin.rpc("doc_set_brand_logo", {
      ...base, p_source_url: avatar, p_content_type: img.kind === "png" ? "image/png" : "image/jpeg", p_b64: Buffer.from(img.bytes).toString("base64"),
    });
  } catch (e) {
    console.error("brand logo sync failed:", e instanceof Error ? e.message : e);
  }
}

export async function loadBrandAsset(admin: any, profileId: string, assetId: string): Promise<LogoBytes | null> {
  try {
    const { data, error } = await admin.rpc("doc_get_brand_asset", { p_profile_id: profileId, p_asset_id: assetId });
    if (error || !data || typeof data.b64 !== "string") return null;
    const bytes = new Uint8Array(Buffer.from(data.b64, "base64"));
    const kind = sniffImage(bytes);
    return kind ? { bytes, kind } : null;
  } catch {
    return null;
  }
}
