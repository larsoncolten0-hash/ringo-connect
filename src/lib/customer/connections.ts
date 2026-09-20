import { createAdminClient } from "@/lib/supabase/server";

export type MyConnection = {
  id: string;
  isFavorite: boolean;
  connectedAt: string;
  profile: {
    id: string;
    name: string;
    username: string;
    avatarUrl: string | null;
    category: string | null;
  };
};

/**
 * The customer's ACTIVE connections, newest first. `customerId` must come
 * from the server-side customer session (requireCustomer()) — never from a
 * request. Disconnected rows are excluded (kept in the table for a future
 * history view), and so are connections to profiles that are no longer
 * published, since their public page would 404.
 */
export async function listActiveConnections(customerId: string, limit = 100): Promise<MyConnection[]> {
  return listConnectionsByStatus(customerId, "active", limit);
}

/** Connections the customer disconnected from, so they can reconnect in one tap. Same rules as above. */
export async function listDisconnectedConnections(customerId: string, limit = 100): Promise<MyConnection[]> {
  return listConnectionsByStatus(customerId, "disconnected", limit);
}

async function listConnectionsByStatus(customerId: string, status: "active" | "disconnected", limit: number): Promise<MyConnection[]> {
  const { data, error } = await createAdminClient()
    .from("customer_connections")
    .select("id, is_favorite, connected_at, profiles!inner(id, name, username, avatar_url, category, published)")
    .eq("customer_id", customerId)
    .eq("status", status)
    .eq("profiles.published", true)
    .order("connected_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("listConnectionsByStatus failed:", error.message);
    return [];
  }

  return (data || []).flatMap((row: any) => {
    const p = Array.isArray(row.profiles) ? row.profiles[0] : row.profiles;
    if (!p?.username) return [];
    return [
      {
        id: row.id,
        isFavorite: row.is_favorite === true,
        connectedAt: row.connected_at,
        profile: {
          id: p.id,
          name: p.name || p.username,
          username: p.username,
          avatarUrl: p.avatar_url ?? null,
          category: p.category ?? null,
        },
      },
    ];
  });
}
