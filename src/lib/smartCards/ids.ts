export const isUuidLike = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/** First address of x-forwarded-for (set by the platform edge), else a fixed bucket. Only ever hashed before it is stored. */
export function clientIp(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  const first = xff ? xff.split(",")[0].trim() : "";
  return first || headers.get("x-real-ip") || "unknown";
}
