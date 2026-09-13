// Shared by the admin verification queue's initial server-rendered list
// (src/app/admin/verification/page.tsx) and its polling refresh
// (src/app/api/admin/verification/requests/route.ts) — one place for
// "what a request row looks like from the admin side," so the two can
// never quietly drift apart. Same pattern as src/lib/support.ts.
export type AdminVerificationRequest = {
  id: string;
  userId: string;
  email: string | null;
  username: string | null;
  fullName: string;
  phoneNumber: string;
  location: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
};

export async function listVerificationRequests(admin: any): Promise<AdminVerificationRequest[]> {
  const { data: requests, error } = await admin
    .from("verification_requests")
    .select("id, user_id, full_name, phone_number, location, status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("listVerificationRequests failed:", error.message);
    return [];
  }

  // profiles/users aren't joined via a nested PostgREST select — there's
  // no direct FK from verification_requests to profiles (both merely
  // reference users) — so two follow-up queries plus an in-memory merge
  // is simpler than relying on a multi-hop embed.
  const userIds = Array.from(new Set((requests || []).map((r: any) => r.user_id).filter(Boolean)));
  const [{ data: users }, { data: profiles }] = await Promise.all([
    userIds.length ? admin.from("users").select("id, email").in("id", userIds) : Promise.resolve({ data: [] as any[] }),
    userIds.length ? admin.from("profiles").select("user_id, username").in("user_id", userIds) : Promise.resolve({ data: [] as any[] }),
  ]);
  const userById = new Map((users || []).map((u: any) => [u.id, u]));
  const profileByUserId = new Map((profiles || []).map((p: any) => [p.user_id, p]));

  return (requests || []).map((r: any) => {
    const userRow: any = userById.get(r.user_id);
    const profile: any = profileByUserId.get(r.user_id);
    return {
      id: r.id,
      userId: r.user_id,
      email: userRow?.email ?? null,
      username: profile?.username ?? null,
      fullName: r.full_name,
      phoneNumber: r.phone_number,
      location: r.location,
      status: r.status,
      createdAt: r.created_at,
    };
  });
}
