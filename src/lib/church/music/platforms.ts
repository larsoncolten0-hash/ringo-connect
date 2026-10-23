// Churches & Ministries Church Music (Phase 8): the platforms a church may link to, and the addresses that belong to each. Pure: no I/O, no React. Shared by the API (which refuses a mismatch)
// and by the public page (which drops a stored link that no longer matches, as defence in depth).

import { has } from "../validation";

/** Platform -> the domains a link for it may be on (the domain itself or any subdomain of it). `website` and `other` accept any secure address. */
export const MUSIC_PLATFORMS: Record<string, readonly string[] | null> = {
  spotify: ["spotify.com", "spotify.link", "spoti.fi"],
  apple_music: ["music.apple.com", "itunes.apple.com"],
  youtube: ["youtube.com", "youtu.be"],
  youtube_music: ["music.youtube.com"],
  deezer: ["deezer.com", "deezer.page.link", "link.deezer.com"],
  audiomack: ["audiomack.com"],
  boomplay: ["boomplay.com"],
  soundcloud: ["soundcloud.com"],
  bandcamp: ["bandcamp.com"],
  tidal: ["tidal.com"],
  amazon_music: ["music.amazon.com", "music.amazon.fr", "music.amazon.co.uk"],
  website: null,
  other: null,
};
export const MUSIC_PLATFORM_IDS = Object.keys(MUSIC_PLATFORMS);

/** True when `url` is a secure address on one of the platform's domains (or any secure address for website / other). */
export function urlMatchesPlatform(platform: string, url: string): boolean {
  if (!has(MUSIC_PLATFORMS, platform)) return false;
  const domains = MUSIC_PLATFORMS[platform];
  if (domains === null) return true;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}
