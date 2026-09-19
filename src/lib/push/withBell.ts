import { sendPushToUser, sendPushToUsers, sendPushToAdmins, type PushPayload } from "./send";

// Push + bell in one call. Every OS-level push aimed at a signed-in
// account (creator, staff, admin) must also appear in that account's
// in-app bell (NotificationBell, backed by the `notifications` table) and
// open the same destination when clicked — so the two are written
// together from one payload instead of being two calls that can drift
// apart. `payload.category` becomes the bell row's `type` and
// `payload.url` its `link`, which is exactly what NotificationBell
// navigates to.
//
// Like everything in send.ts, these never throw: a failed bell insert is
// logged and the push still goes out (and vice versa).

async function insertBellRows(admin: any, rows: Record<string, unknown>[]) {
  if (rows.length === 0) return;
  try {
    // Chunked so a platform-wide broadcast never builds one giant insert.
    for (let i = 0; i < rows.length; i += 500) {
      const { error } = await admin.from("notifications").insert(rows.slice(i, i + 500));
      if (error) console.error("bell insert failed:", error.message);
    }
  } catch (err) {
    console.error("bell insert threw:", err);
  }
}

function bellRow(payload: PushPayload) {
  return { type: payload.category, title: payload.title, body: payload.body || null, link: payload.url ?? null };
}

export async function sendPushAndBellToUsers(admin: any, userIds: (string | null | undefined)[], payload: PushPayload): Promise<void> {
  const ids = Array.from(new Set(userIds.filter((id): id is string => !!id)));
  if (ids.length === 0) return;
  await Promise.all([
    insertBellRows(admin, ids.map((id) => ({ audience: "user", user_id: id, ...bellRow(payload) }))),
    sendPushToUsers(admin, ids, payload),
  ]);
}

export async function sendPushAndBellToUser(admin: any, userId: string | null | undefined, payload: PushPayload): Promise<void> {
  if (!userId) return;
  await Promise.all([
    insertBellRows(admin, [{ audience: "user", user_id: userId, ...bellRow(payload) }]),
    sendPushToUser(admin, userId, payload),
  ]);
}

export async function sendPushAndBellToAdmins(admin: any, payload: PushPayload): Promise<void> {
  await Promise.all([insertBellRows(admin, [{ audience: "admin", ...bellRow(payload) }]), sendPushToAdmins(admin, payload)]);
}

// Platform broadcast to every account — one bell row per user.
export async function bellToAllUsers(admin: any, payload: PushPayload): Promise<void> {
  try {
    const { data: users } = await admin.from("users").select("id");
    await insertBellRows(
      admin,
      (users || []).map((u: any) => ({ audience: "user", user_id: u.id, ...bellRow(payload) }))
    );
  } catch (err) {
    console.error("bellToAllUsers failed:", err);
  }
}
