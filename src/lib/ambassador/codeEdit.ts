// An Ambassador (and a Team Leader who added their own Ambassador profile — that
// profile's code IS their personal code) changes THEIR OWN sales code, exactly like
// an affiliate customises theirs.
//
// The person is the caller's verified session identity; the request supplies only the
// new code. Rules:
//   * only an ACTIVE Ambassador may change it (pending / inactive / suspended may not);
//   * the format is shared with the browser (src/lib/ambassadorCode.ts);
//   * uniqueness is enforced by the database's unique constraint on sales_code — the
//     friendly pre-check only avoids a generic error, the constraint is what closes the
//     race between two people saving the same free code at once;
//   * the write is guarded by status = 'active' as well, so a suspension that lands
//     between the check and the write still wins;
//   * NOTHING ELSE about the profile is touched, and sales already attributed keep their
//     Ambassador — attribution is stored by profile id, not by code text.
// Consequence worth knowing (shown to the person before they save): the OLD code stops
// resolving immediately, so links already shared with it no longer credit them.
// Audited in ambassador_admin_actions (codes are not sensitive).
import { normalizeAmbassadorCode, isValidAmbassadorCodeFormat } from "@/lib/ambassadorCode";

export type CodeEditErrorCode = "invalid_code" | "taken" | "not_ambassador" | "not_active" | "unavailable";

export async function changeMySalesCode(admin: any, userId: string, rawCode: unknown): Promise<{ ok: true; code: string; changed: boolean } | { ok: false; code: CodeEditErrorCode }> {
  const code = normalizeAmbassadorCode(typeof rawCode === "string" ? rawCode : "");
  if (!isValidAmbassadorCodeFormat(code)) return { ok: false, code: "invalid_code" };

  const { data: profile } = await admin.from("ambassador_profiles").select("id, sales_code, status").eq("user_id", userId).maybeSingle();
  if (!profile) return { ok: false, code: "not_ambassador" };
  if (profile.status !== "active") return { ok: false, code: "not_active" };
  const before = profile.sales_code;
  if (before === code) return { ok: true, code, changed: false };

  const { data: taken } = await admin.from("ambassador_profiles").select("id").eq("sales_code", code).maybeSingle();
  if (taken && taken.id !== profile.id) return { ok: false, code: "taken" };

  const { data: updated, error } = await admin.from("ambassador_profiles").update({ sales_code: code }).eq("id", profile.id).eq("status", "active").select("id, sales_code").maybeSingle();
  if (error) {
    // 23505 = unique_violation: someone saved the same code at the same instant.
    if ((error as any).code === "23505" || /duplicate key|unique/i.test(error.message || "")) return { ok: false, code: "taken" };
    console.error("ambassador code change failed:", error.message);
    return { ok: false, code: "unavailable" };
  }
  if (!updated) return { ok: false, code: "not_active" };

  try {
    await admin.from("ambassador_admin_actions").insert({
      actor_user_id: userId,
      action: "ambassador_code_changed",
      target_table: "ambassador_profiles",
      target_id: profile.id,
      before: { sales_code: before },
      after: { sales_code: code },
      reason: null,
    });
  } catch (err: any) {
    console.error("ambassador code change audit failed:", err?.message);
  }
  return { ok: true, code, changed: true };
}
