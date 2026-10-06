// Which of an artist's real releases is "the latest": the newest EP / album or standalone single, by when it was added. Pure, no I/O.
//
// The public Music profile leads with the artist's own PIN when there is one (their choice always wins). When nothing is pinned this picks the newest real
// thing they have published, so a fan lands on the music instead of a list. It invents nothing: with no release and no single, the answer is null and
// nothing renders. A track that belongs to an EP or album is not a candidate on its own (the release is the thing), and anything marked unavailable is skipped.
export type LatestRelease = { kind: "release"; item: any } | { kind: "track"; item: any };

const added = (row: any): number => {
  const ms = Date.parse(row?.created_at);
  return Number.isFinite(ms) ? ms : 0;
};

export function pickLatestRelease(releases: any[] | null | undefined, tracks: any[] | null | undefined): LatestRelease | null {
  const candidates: LatestRelease[] = [
    ...(releases || []).filter((r) => r && r.available !== false).map((item) => ({ kind: "release" as const, item })),
    ...(tracks || []).filter((t) => t && t.available !== false && !t.release_id).map((item) => ({ kind: "track" as const, item })),
  ];
  if (candidates.length === 0) return null;
  // newest first; when two were added together (or have no date) the creator's own order decides
  candidates.sort((a, b) => added(b.item) - added(a.item) || (a.item.sort_order ?? 0) - (b.item.sort_order ?? 0));
  return candidates[0];
}
