// Churches & Ministries Recurring Weekly Services: the calendar maths (src/lib/church/schedule/occurrences.ts) and the public shaping (src/lib/church/public/services.ts). Offline: no database, no network.
//   * the church's OWN timezone decides the local day and hour (Douala, Paris, New York, Kolkata): nothing is hardcoded to Yaounde;
//   * daylight saving: a time that does not exist moves forward, a time that exists twice means the first one;
//   * week boundaries: Saturday night -> Sunday, Sunday night -> Monday, a service that ended earlier today rolls to next week;
//   * live / upcoming / ended, countdowns, several services on the same day, disabled and unusable services;
//   * the stable occurrence key attendance will attach to, and nothing dated is ever produced beyond what is asked for;
//   * the public loader keeps only enabled, valid, titled services and never fails the page.
//   Run:  node scripts/tests/churchServiceSchedule.test.mjs
import path from "path";
import { SRC, jiti } from "./ministryUiHarness.mjs";

let pass = 0, fail = 0;
const check = (name, cond, detail = "") => { if (cond) pass++; else { fail++; console.log("  FAIL:", name, "|", String(detail).slice(0, 400)); } };
const eq = (name, a, b) => check(name, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

const O = jiti(path.join(SRC, "lib/church/schedule/occurrences.ts"));
const PS = jiti(path.join(SRC, "lib/church/public/services.ts"));
const iso = (ms) => new Date(ms).toISOString();
const utc = (s) => Date.parse(s);

const svc = (o = {}) => ({ id: "s1", weekday: 0, start_time: "09:00", end_time: "12:00", timezone: "Africa/Douala", is_enabled: true, title_en: "Sunday worship", ...o });

// ---------------------------------------------------------------- 1. timezones and local time
{
  check("known zones are valid", ["Africa/Douala", "Europe/Paris", "America/New_York", "Asia/Kolkata", "UTC"].every(O.isValidTimezone));
  check("unknown / malformed zones are refused", ["Mars/Phobos", "", "Africa/Douala; drop", "a".repeat(70), null, 5, undefined, "../etc"].every((z) => !O.isValidTimezone(z)));
  eq("Douala is UTC+1 all year: Sunday 2026-11-01 09:00 = 08:00Z", iso(O.zonedTimeToMs("2026-11-01", "09:00", "Africa/Douala")), "2026-11-01T08:00:00.000Z");
  eq("Douala has no daylight saving: the same in July", iso(O.zonedTimeToMs("2026-07-05", "09:00", "Africa/Douala")), "2026-07-05T08:00:00.000Z");
  eq("Paris summer (UTC+2): 09:00 = 07:00Z", iso(O.zonedTimeToMs("2026-07-05", "09:00", "Europe/Paris")), "2026-07-05T07:00:00.000Z");
  eq("Paris winter (UTC+1): 09:00 = 08:00Z", iso(O.zonedTimeToMs("2026-12-06", "09:00", "Europe/Paris")), "2026-12-06T08:00:00.000Z");
  eq("a half-hour zone (Kolkata, UTC+5:30): 17:30 = 12:00Z", iso(O.zonedTimeToMs("2026-11-01", "17:30", "Asia/Kolkata")), "2026-11-01T12:00:00.000Z");
  eq("the same wall time differs by zone: 09:00 in New York (EST) = 14:00Z", iso(O.zonedTimeToMs("2026-12-06", "09:00", "America/New_York")), "2026-12-06T14:00:00.000Z");
  eq("a database time with seconds is accepted", iso(O.zonedTimeToMs("2026-11-01", "17:30:00", "Africa/Douala")), "2026-11-01T16:30:00.000Z");
  check("bad date / time / zone give null, never a guess", O.zonedTimeToMs("2026-02-30", "09:00", "Africa/Douala") === null && O.zonedTimeToMs("2026-11-01", "25:00", "Africa/Douala") === null && O.zonedTimeToMs("2026-11-01", "09:00", "Nowhere/Land") === null);
  eq("local date of an instant follows the zone (23:30Z is already Monday in Douala, still Sunday in New York)", [O.localDate(utc("2026-11-01T23:30:00Z"), "Africa/Douala"), O.localDate(utc("2026-11-01T23:30:00Z"), "America/New_York")], ["2026-11-02", "2026-11-01"]);
}

// ---------------------------------------------------------------- 2. daylight saving
{
  // New York 2026: clocks go forward on Sunday 8 March (02:00 -> 03:00) and back on Sunday 1 November (02:00 -> 01:00)
  eq("spring forward: 02:30 does not exist, so it moves forward to 03:30 EDT = 07:30Z", iso(O.zonedTimeToMs("2026-03-08", "02:30", "America/New_York")), "2026-03-08T07:30:00.000Z");
  eq("the day before the change is still EST: 09:00 = 14:00Z", iso(O.zonedTimeToMs("2026-03-07", "09:00", "America/New_York")), "2026-03-07T14:00:00.000Z");
  eq("the change day itself, after the jump, is EDT: 09:00 = 13:00Z", iso(O.zonedTimeToMs("2026-03-08", "09:00", "America/New_York")), "2026-03-08T13:00:00.000Z");
  eq("fall back: 01:30 exists twice, the FIRST one (EDT) = 05:30Z", iso(O.zonedTimeToMs("2026-11-01", "01:30", "America/New_York")), "2026-11-01T05:30:00.000Z");
  eq("after the repeat, 09:00 is EST = 14:00Z", iso(O.zonedTimeToMs("2026-11-01", "09:00", "America/New_York")), "2026-11-01T14:00:00.000Z");
  // a Sunday service across the change keeps its LOCAL hour: 09:00 both weeks, 1 hour apart in UTC
  const ny = svc({ timezone: "America/New_York" });
  const before = O.occurrenceOn(ny, "2026-03-01", 0), after = O.occurrenceOn(ny, "2026-03-08", 0);
  eq("a weekly service keeps its local hour across the change (UTC distance is 7 days minus 1 hour)", (after.startMs - before.startMs) / 3600000, 7 * 24 - 1);
  // a service whose end falls in the gap still lasts at least a minute
  const gap = O.occurrenceOn(svc({ timezone: "America/New_York", weekday: 0, start_time: "01:00", end_time: "02:30" }), "2026-03-08", 0);
  check("a service ending inside the spring gap still has a positive length", gap.endMs > gap.startMs, JSON.stringify(gap));
}

// ---------------------------------------------------------------- 3. status, countdown and week boundaries (Douala, Sunday 09:00-12:00 local = 08:00-11:00Z)
{
  const s = svc();
  const sunday = "2026-11-01";
  const at = (z) => utc(z);
  const upcoming = O.occurrenceOn(s, sunday, at("2026-11-01T07:00:00Z"));
  eq("one hour before: upcoming, one hour to go", [upcoming.status, upcoming.msUntilStart], ["upcoming", 3600000]);
  eq("the exact start instant is live", O.occurrenceOn(s, sunday, at("2026-11-01T08:00:00Z")).status, "live");
  eq("inside the service: live, end in one hour", (({ status, msUntilEnd }) => [status, msUntilEnd])(O.occurrenceOn(s, sunday, at("2026-11-01T10:00:00Z"))), ["live", 3600000]);
  eq("the exact end instant is ended", O.occurrenceOn(s, sunday, at("2026-11-01T11:00:00Z")).status, "ended");
  eq("occurrenceOn refuses a date that is not the service's weekday", O.occurrenceOn(s, "2026-11-02", 0), null);
  eq("the key is the service id and the LOCAL date", O.occurrenceOn(s, sunday, 0).key, "s1:2026-11-01");

  const cur = (z, services = [s]) => O.currentOccurrences(services, at(z));
  // Saturday night -> tomorrow
  let r = cur("2026-10-31T22:30:00Z"); // Saturday 23:30 in Douala
  eq("Saturday 23:30: the Sunday service is next, dated tomorrow", [r.length, r[0].date, r[0].status], [1, "2026-11-01", "upcoming"]);
  // Sunday before the service
  r = cur("2026-11-01T07:30:00Z");
  eq("Sunday 08:30 Douala: today's service, 30 minutes away", [r[0].date, r[0].status, r[0].msUntilStart], ["2026-11-01", "upcoming", 1800000]);
  // during
  r = cur("2026-11-01T09:00:00Z");
  eq("Sunday 10:00 Douala: happening now", [r.length, r[0].status], [1, "live"]);
  // after: ended today AND next week's shown
  r = cur("2026-11-01T12:00:00Z");
  eq("Sunday 13:00 Douala: today's service shows as ended and next Sunday is upcoming", r.map((o) => [o.date, o.status]), [["2026-11-08", "upcoming"], ["2026-11-01", "ended"]]);
  // Sunday night -> Monday: the ended one has gone, only next Sunday remains
  r = cur("2026-11-01T23:30:00Z"); // already Monday 00:30 in Douala
  eq("Monday 00:30 Douala: yesterday's service is gone, next Sunday is the only one", r.map((o) => [o.date, o.status]), [["2026-11-08", "upcoming"]]);
  // the local day is the SERVICE's zone: the same instant for a New York church is still Sunday evening
  r = cur("2026-11-01T23:30:00Z", [svc({ timezone: "America/New_York" })]);
  eq("the same instant for a New York church is still Sunday: today's 09:00 service has ended, next week follows", r.map((o) => [o.date, o.status]), [["2026-11-08", "upcoming"], ["2026-11-01", "ended"]]);
  // a mid-week service
  r = cur("2026-11-01T12:00:00Z", [svc({ id: "t1", weekday: 2, start_time: "17:30", end_time: "21:00" })]);
  eq("Tuesday service seen on a Sunday: the coming Tuesday", [r[0].date, r[0].status], ["2026-11-03", "upcoming"]);
  // far from the week boundary the answer is never more than 7 days ahead
  r = cur("2026-11-04T10:00:00Z");
  check("an upcoming service is always within the next 7 days", r.every((o) => o.status !== "upcoming" || o.startMs - at("2026-11-04T10:00:00Z") <= 7 * 86400000));
}

// ---------------------------------------------------------------- 4. several services, disabled and unusable ones, ordering, nothing is multiplied
{
  const now = utc("2026-11-03T15:00:00Z"); // Tuesday 16:00 in Douala
  const tue = svc({ id: "tue", weekday: 2, start_time: "17:30", end_time: "21:00", title_en: "Tuesday prayer" });
  const tue2 = svc({ id: "tue2", weekday: 2, start_time: "07:00", end_time: "08:00", title_en: "Tuesday dawn" });
  const thu = svc({ id: "thu", weekday: 4, start_time: "17:30", end_time: "21:00", title_en: "Thursday prayer" });
  const sun = svc({ id: "sun", weekday: 0, title_en: "Sunday worship" });
  const r = O.currentOccurrences([sun, thu, tue, tue2], now);
  eq("two services on one day are both found; upcoming soonest first, then what already ended today (which also rolls to next week)", r.map((o) => `${o.service.id}:${o.status}`), ["tue:upcoming", "thu:upcoming", "sun:upcoming", "tue2:upcoming", "tue2:ended"]);
  check("each service has at most ONE upcoming occurrence (no weekly copies) and at most one ended-today", ["upcoming", "ended"].every((st) => { const ids = r.filter((o) => o.status === st).map((o) => o.service.id); return new Set(ids).size === ids.length; }) && r.filter((o) => o.status === "upcoming").length === 4);
  eq("a live service always comes first", O.currentOccurrences([sun, thu, tue], utc("2026-11-03T17:00:00Z"))[0].service.id, "tue");
  eq("the same input and time give the same answer (pure)", O.currentOccurrences([sun, thu, tue, tue2], now).map((o) => o.key), r.map((o) => o.key));

  eq("a disabled service is skipped", O.currentOccurrences([svc({ is_enabled: false })], now), []);
  eq("an unknown timezone is skipped, not guessed", O.currentOccurrences([svc({ timezone: "Mars/Phobos" })], now), []);
  eq("a weekday outside 0-6 is skipped", O.currentOccurrences([svc({ weekday: 9 }), svc({ weekday: -1 }), svc({ weekday: 1.5 })], now), []);
  eq("an unusable time is skipped", O.currentOccurrences([svc({ start_time: "nine" })], now), []);
  check("the limit caps the list but keeps a live service", O.currentOccurrences([sun, thu, tue, tue2], utc("2026-11-03T17:00:00Z"), 1)[0].status === "live");
  eq("nextOccurrence ignores ended ones", O.nextOccurrence(tue2, now).date, "2026-11-10");
  eq("nextOccurrence of a service that is live is that occurrence", O.nextOccurrence(tue, utc("2026-11-03T17:00:00Z")).status, "live");
}

// ---------------------------------------------------------------- 5. countdown, time parsing
{
  eq("countdown 2d 3h 10m", O.countdownParts(((2 * 24 + 3) * 60 + 10) * 60000), { days: 2, hours: 3, minutes: 10 });
  eq("countdown rounds DOWN to the minute", O.countdownParts(59999), { days: 0, hours: 0, minutes: 0 });
  eq("a negative countdown is zero", O.countdownParts(-5000), { days: 0, hours: 0, minutes: 0 });
  eq("normalizeTime", [O.normalizeTime("07:05"), O.normalizeTime("07:05:30"), O.normalizeTime("7:05"), O.normalizeTime("24:00"), O.normalizeTime(null)], ["07:05", "07:05", null, null, null]);
  eq("the dashboard lists Monday first, Sunday last", O.WEEKDAY_ORDER_MONDAY_FIRST, [1, 2, 3, 4, 5, 6, 0]);
}

// ---------------------------------------------------------------- 6. the public shape of a service
{
  const id = (n) => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
  const row = (o = {}) => ({ id: id(1), title_en: "Sunday worship", title_fr: null, description_en: null, description_fr: null, location: null, weekday: 0, start_time: "09:00:00", end_time: "12:00:00", timezone: "Africa/Douala", is_enabled: true, ...o });
  const out = PS.shapePublicServices([row(), row({ id: id(2), is_enabled: false }), row({ id: id(3), archived_at: "2026-01-01T00:00:00Z" }), row({ id: id(4), timezone: "Mars/Phobos" }), row({ id: id(5), weekday: 7 }), row({ id: id(6), start_time: "12:00", end_time: "09:00" }), row({ id: id(7), title_en: "  ", title_fr: null }), row({ id: "not-a-uuid" }), null, "x", row({ id: id(8), weekday: 2, title_en: null, title_fr: "Prière du mardi", start_time: "17:30:00", end_time: "21:00:00", location: " Salle B " })]);
  eq("only enabled, current, valid, titled services are kept, in weekday then time order", out.map((s) => s.id), [id(1), id(8)]);
  eq("times are trimmed to HH:MM and text is cleaned", [out[0].start_time, out[1].end_time, out[1].location], ["09:00", "21:00", "Salle B"]);
  eq("not an array gives an empty list", [PS.shapePublicServices(null), PS.shapePublicServices({}), PS.shapePublicServices(undefined)], [[], [], []]);
  check("the public columns never include the audit or archive columns", !/created_by|updated_by|archived_at|profile_id/.test(PS.PUBLIC_SERVICE_COLUMNS));
  const reader = (result) => ({ from: () => { const q = { select: () => q, eq: () => q, is: () => q, order: () => q, limit: () => Promise.resolve(result) }; return q; } });
  eq("the loader returns the shaped rows", (await PS.loadPublicServices(reader({ data: [row()], error: null }), id(9))).length, 1);
  eq("a database error gives an empty list (a table not created yet never breaks the page)", await PS.loadPublicServices(reader({ data: null, error: { code: "42P01" } }), id(9)), []);
  eq("a thrown error gives an empty list", await PS.loadPublicServices({ from: () => { throw new Error("boom"); } }, id(9)), []);
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"}: ${pass} checks passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
