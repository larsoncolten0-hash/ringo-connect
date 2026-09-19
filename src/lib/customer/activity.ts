import { createAdminClient } from "@/lib/supabase/server";
import { resolveOwnedOrderIds } from "@/lib/customer/orderLinks";
import { listLoyaltyFeed } from "@/lib/loyalty/customerFeed";

// Everything here takes `customer` from the server-side customer session
// (requireCustomer()) and only ever returns records explicitly linked to them
// from an authenticated checkout (see resolveOwnedOrderIds). Nothing is copied into an activity table —
// this reads the authoritative records directly, so it can never drift from
// them or show something that didn't happen. Only customer-facing fields
// are selected (no fapshi ids, commissions, internal notes, other people's
// data).

type Customer = { id: string };

async function fetchByIds<T = any>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: any[] | null; error: any }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await run(ids.slice(i, i + 100));
    if (error) console.error("customer activity query failed:", error.message);
    out.push(...((data as T[]) || []));
  }
  return out;
}

const one = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

// ---------------------------------------------------------------------
// MY MUSIC — tracks from PAID music orders the customer owns.
// ---------------------------------------------------------------------

export type LibraryTrack = {
  key: string;
  trackId: string;
  // The paid order that entitles the customer to this track. It is what the
  // EXISTING /api/music/tracks/[id]/audio route authorizes against; that
  // route is unchanged and still re-checks payment and ownership itself.
  orderId: string;
  title: string;
  artistName: string;
  artistUsername: string | null;
  coverUrl: string | null;
  purchasedAt: string;
  canDownload: boolean;
};

export async function listMusicLibrary(customer: Customer): Promise<LibraryTrack[]> {
  const admin = createAdminClient();
  const orderIds = await resolveOwnedOrderIds(customer, "music_order");
  if (orderIds.length === 0) return [];

  const orders = await fetchByIds(orderIds, (chunk) =>
    admin
      .from("music_orders")
      .select("id, created_at, profiles(name, username), music_order_items(item_type, track_id, release_id)")
      .in("id", chunk)
      .eq("payment_status", "paid")
  );

  const songIds = new Set<string>();
  const releaseIds = new Set<string>();
  for (const o of orders) {
    for (const item of o.music_order_items || []) {
      if (item.item_type === "song" && item.track_id) songIds.add(item.track_id);
      if (item.item_type === "release" && item.release_id) releaseIds.add(item.release_id);
    }
  }

  const trackSelect = "id, title, artist_name, cover_image_url, release_id, protected_audio_path, download_enabled";
  const [songTracks, releaseTracks] = await Promise.all([
    fetchByIds([...songIds], (chunk) => admin.from("tracks").select(trackSelect).in("id", chunk)),
    fetchByIds([...releaseIds], (chunk) => admin.from("tracks").select(trackSelect).in("release_id", chunk)),
  ]);
  const tracksById = new Map<string, any>();
  for (const t of [...songTracks, ...releaseTracks]) tracksById.set(t.id, t);
  const tracksByRelease = new Map<string, any[]>();
  for (const t of releaseTracks) {
    if (!t.release_id) continue;
    tracksByRelease.set(t.release_id, [...(tracksByRelease.get(t.release_id) || []), t]);
  }

  const entries: LibraryTrack[] = [];
  const seen = new Set<string>();
  const add = (order: any, track: any) => {
    // Only tracks sold as a real gated purchase have a way to be played;
    // anything without protected audio has no access mechanism to reuse.
    if (!track?.protected_audio_path) return;
    const key = `${order.id}:${track.id}`;
    if (seen.has(key)) return;
    seen.add(key);
    const profile = one<any>(order.profiles);
    entries.push({
      key,
      trackId: track.id,
      orderId: order.id,
      title: track.title,
      artistName: track.artist_name || profile?.name || profile?.username || "",
      artistUsername: profile?.username ?? null,
      coverUrl: track.cover_image_url ?? null,
      purchasedAt: order.created_at,
      canDownload: track.download_enabled !== false,
    });
  };

  for (const order of orders) {
    for (const item of order.music_order_items || []) {
      if (item.item_type === "song") add(order, tracksById.get(item.track_id));
      if (item.item_type === "release") for (const t of tracksByRelease.get(item.release_id) || []) add(order, t);
    }
  }

  return entries.sort((a, b) => new Date(b.purchasedAt).getTime() - new Date(a.purchasedAt).getTime());
}

// ---------------------------------------------------------------------
// ACTIVITY — connections + music orders + restaurant orders + bookings.
// ---------------------------------------------------------------------

export type ActivityKind =
  | "connected"
  | "disconnected"
  | "music_order"
  | "restaurant_order"
  | "booking"
  // Ringo Loyalty (see src/lib/loyalty/customerFeed.ts). Rendered from structured data + translations.
  | "loyalty_progress"
  | "loyalty_correction"
  | "reward_unlocked"
  | "reward_redeemed"
  | "package_activated"
  | "package_used";

// Structured facts for a loyalty event; the wording is built client-side from translations so it
// is English or French to match the customer's language.
export type LoyaltyFeedInfo = {
  type?: "visits" | "spend" | "points";
  actionKey?: string;
  progress?: number | null;
  target?: number | null;
  currency?: string | null;
  rewardTitle?: string;
  packageName?: string;
  remaining?: number | null;
  endsAt?: string | null;
};

export type ActivityItem = {
  id: string;
  kind: ActivityKind;
  at: string;
  profile: { name: string; username: string } | null;
  orderNumber?: number | null;
  summary?: string | null;
  amount?: number | null;
  currency?: string;
  paymentStatus?: "paid" | "unpaid";
  status?: string;
  // An EXISTING receipt / tracking page for that record (public by its own
  // unguessable id, and only ever surfaced here for records the customer owns).
  href?: string | null;
  loyalty?: LoyaltyFeedInfo;
};

const summarize = (names: (string | null | undefined)[]) => {
  const list = names.filter(Boolean) as string[];
  if (list.length === 0) return null;
  const text = list.slice(0, 3).join(", ");
  return list.length > 3 ? `${text} +${list.length - 3}` : text;
};

export async function listActivity(customer: Customer, limit = 100): Promise<ActivityItem[]> {
  const admin = createAdminClient();
  const items: ActivityItem[] = [];

  // Connections — the customer's own rows, both events (a re-connect resets
  // disconnected_at, so only the current state's events are known).
  const { data: connections, error: connError } = await admin
    .from("customer_connections")
    .select("id, status, connected_at, disconnected_at, profiles(name, username)")
    .eq("customer_id", customer.id);
  if (connError) console.error("customer activity connections failed:", connError.message);
  for (const c of connections || []) {
    const p = one<any>((c as any).profiles);
    const profile = p?.username ? { name: p.name || p.username, username: p.username } : null;
    items.push({ id: `${c.id}:connected`, kind: "connected", at: c.connected_at, profile });
    if (c.status === "disconnected" && c.disconnected_at) {
      items.push({ id: `${c.id}:disconnected`, kind: "disconnected", at: c.disconnected_at, profile });
    }
  }

  const [musicIds, restaurantIds, bookingIds] = await Promise.all([
    resolveOwnedOrderIds(customer, "music_order"),
    resolveOwnedOrderIds(customer, "restaurant_order"),
    resolveOwnedOrderIds(customer, "booking"),
  ]);

  const [musicOrders, restaurantOrders, bookings] = await Promise.all([
    fetchByIds(musicIds, (chunk) =>
      admin
        .from("music_orders")
        .select("id, order_number, created_at, total, payment_status, status, profiles(name, username, currency), music_order_items(name_snapshot)")
        .in("id", chunk)
    ),
    fetchByIds(restaurantIds, (chunk) =>
      admin
        .from("orders")
        .select("id, order_number, created_at, total, payment_status, status, profiles(name, username, currency), order_items(item_name_snapshot)")
        .in("id", chunk)
    ),
    fetchByIds(bookingIds, (chunk) =>
      admin
        .from("bookings")
        .select("id, created_at, status, service_name_snapshot, profiles(name, username)")
        .in("id", chunk)
    ),
  ]);

  const profileOf = (row: any) => {
    const p = one<any>(row.profiles);
    return p?.username ? { name: p.name || p.username, username: p.username, currency: p.currency as string | null } : null;
  };

  for (const o of musicOrders) {
    const p = profileOf(o);
    items.push({
      id: o.id,
      kind: "music_order",
      at: o.created_at,
      profile: p && { name: p.name, username: p.username },
      orderNumber: o.order_number,
      summary: summarize((o.music_order_items || []).map((i: any) => i.name_snapshot)),
      amount: Number(o.total),
      currency: p?.currency || "USD",
      paymentStatus: o.payment_status === "paid" ? "paid" : "unpaid",
      status: o.status,
      href: p ? `/m/${p.username}/receipt/${o.id}` : null,
    });
  }
  for (const o of restaurantOrders) {
    const p = profileOf(o);
    items.push({
      id: o.id,
      kind: "restaurant_order",
      at: o.created_at,
      profile: p && { name: p.name, username: p.username },
      orderNumber: o.order_number,
      summary: summarize((o.order_items || []).map((i: any) => i.item_name_snapshot)),
      amount: Number(o.total),
      currency: p?.currency || "USD",
      paymentStatus: o.payment_status === "paid" ? "paid" : "unpaid",
      status: o.status,
      href: `/order/${o.id}`,
    });
  }
  for (const b of bookings) {
    const p = profileOf(b);
    items.push({
      id: b.id,
      kind: "booking",
      at: b.created_at,
      profile: p && { name: p.name, username: p.username },
      summary: b.service_name_snapshot,
      status: b.status,
      href: null,
    });
  }

  // Ringo Loyalty events join the same feed. Additive and isolated: if the loyalty tables are
  // unavailable for any reason, the rest of the feed is returned exactly as before.
  try {
    items.push(...(await listLoyaltyFeed(customer.id)));
  } catch (err) {
    console.error("customer activity loyalty events failed:", (err as any)?.message ?? "unknown error");
  }

  return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit);
}
