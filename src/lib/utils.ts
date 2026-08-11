const PLATFORM_PATTERNS: [string, RegExp][] = [
  ["instagram", /instagram\.com/i],
  ["tiktok", /tiktok\.com/i],
  ["x", /(twitter\.com|x\.com)/i],
  ["youtube", /(youtube\.com|youtu\.be)/i],
  ["facebook", /facebook\.com/i],
  ["linkedin", /linkedin\.com/i],
  ["whatsapp", /wa\.me|whatsapp\.com/i],
  ["threads", /threads\.net/i],
  ["pinterest", /pinterest\.com/i],
  ["snapchat", /snapchat\.com/i],
  ["telegram", /t\.me|telegram\.org/i],
  ["github", /github\.com/i],
];

// Detects a social platform from a pasted profile URL, e.g. for the editor's
// "paste a link, we'll pick the icon" flow.
export function detectPlatform(url: string): string {
  const match = PLATFORM_PATTERNS.find(([, pattern]) => pattern.test(url));
  return match ? match[0] : "link";
}
