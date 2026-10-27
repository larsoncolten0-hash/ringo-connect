// "The Bible in one year": the same reading plan for every church. Pure: no I/O, no React, safe in the browser and on the server.
//
// The plan is GENERATED, not stored: the 66 books of the Protestant canon in canonical order, Genesis to Revelation, 1,189 chapters, shared out over 365 days so that every day has about the same
// number of chapters (3 or 4) and no chapter is read twice or skipped. Only scripture REFERENCES exist here (a book and a chapter range); no Bible text is stored or shown by this feature, so there is
// no translation to license and no text to keep in step. Day 1 starts at Genesis 1 and day 365 ends at Revelation 22.
//
// A reader's day is counted from THEIR start date (the day they opted in, Africa/Douala calendar), so the same plan serves every person and every church, each from their own first day.

export interface BibleBook {
  id: string;
  chapters: number;
  en: string;
  fr: string;
}

export const BIBLE_BOOKS: readonly BibleBook[] = [
  { id: "gen", chapters: 50, en: "Genesis", fr: "Genèse" },
  { id: "exo", chapters: 40, en: "Exodus", fr: "Exode" },
  { id: "lev", chapters: 27, en: "Leviticus", fr: "Lévitique" },
  { id: "num", chapters: 36, en: "Numbers", fr: "Nombres" },
  { id: "deu", chapters: 34, en: "Deuteronomy", fr: "Deutéronome" },
  { id: "jos", chapters: 24, en: "Joshua", fr: "Josué" },
  { id: "jdg", chapters: 21, en: "Judges", fr: "Juges" },
  { id: "rut", chapters: 4, en: "Ruth", fr: "Ruth" },
  { id: "1sa", chapters: 31, en: "1 Samuel", fr: "1 Samuel" },
  { id: "2sa", chapters: 24, en: "2 Samuel", fr: "2 Samuel" },
  { id: "1ki", chapters: 22, en: "1 Kings", fr: "1 Rois" },
  { id: "2ki", chapters: 25, en: "2 Kings", fr: "2 Rois" },
  { id: "1ch", chapters: 29, en: "1 Chronicles", fr: "1 Chroniques" },
  { id: "2ch", chapters: 36, en: "2 Chronicles", fr: "2 Chroniques" },
  { id: "ezr", chapters: 10, en: "Ezra", fr: "Esdras" },
  { id: "neh", chapters: 13, en: "Nehemiah", fr: "Néhémie" },
  { id: "est", chapters: 10, en: "Esther", fr: "Esther" },
  { id: "job", chapters: 42, en: "Job", fr: "Job" },
  { id: "psa", chapters: 150, en: "Psalms", fr: "Psaumes" },
  { id: "pro", chapters: 31, en: "Proverbs", fr: "Proverbes" },
  { id: "ecc", chapters: 12, en: "Ecclesiastes", fr: "Ecclésiaste" },
  { id: "sng", chapters: 8, en: "Song of Solomon", fr: "Cantique des Cantiques" },
  { id: "isa", chapters: 66, en: "Isaiah", fr: "Ésaïe" },
  { id: "jer", chapters: 52, en: "Jeremiah", fr: "Jérémie" },
  { id: "lam", chapters: 5, en: "Lamentations", fr: "Lamentations" },
  { id: "ezk", chapters: 48, en: "Ezekiel", fr: "Ézéchiel" },
  { id: "dan", chapters: 12, en: "Daniel", fr: "Daniel" },
  { id: "hos", chapters: 14, en: "Hosea", fr: "Osée" },
  { id: "jol", chapters: 3, en: "Joel", fr: "Joël" },
  { id: "amo", chapters: 9, en: "Amos", fr: "Amos" },
  { id: "oba", chapters: 1, en: "Obadiah", fr: "Abdias" },
  { id: "jon", chapters: 4, en: "Jonah", fr: "Jonas" },
  { id: "mic", chapters: 7, en: "Micah", fr: "Michée" },
  { id: "nam", chapters: 3, en: "Nahum", fr: "Nahum" },
  { id: "hab", chapters: 3, en: "Habakkuk", fr: "Habacuc" },
  { id: "zep", chapters: 3, en: "Zephaniah", fr: "Sophonie" },
  { id: "hag", chapters: 2, en: "Haggai", fr: "Aggée" },
  { id: "zec", chapters: 14, en: "Zechariah", fr: "Zacharie" },
  { id: "mal", chapters: 4, en: "Malachi", fr: "Malachie" },
  { id: "mat", chapters: 28, en: "Matthew", fr: "Matthieu" },
  { id: "mrk", chapters: 16, en: "Mark", fr: "Marc" },
  { id: "luk", chapters: 24, en: "Luke", fr: "Luc" },
  { id: "jhn", chapters: 21, en: "John", fr: "Jean" },
  { id: "act", chapters: 28, en: "Acts", fr: "Actes" },
  { id: "rom", chapters: 16, en: "Romans", fr: "Romains" },
  { id: "1co", chapters: 16, en: "1 Corinthians", fr: "1 Corinthiens" },
  { id: "2co", chapters: 13, en: "2 Corinthians", fr: "2 Corinthiens" },
  { id: "gal", chapters: 6, en: "Galatians", fr: "Galates" },
  { id: "eph", chapters: 6, en: "Ephesians", fr: "Éphésiens" },
  { id: "php", chapters: 4, en: "Philippians", fr: "Philippiens" },
  { id: "col", chapters: 4, en: "Colossians", fr: "Colossiens" },
  { id: "1th", chapters: 5, en: "1 Thessalonians", fr: "1 Thessaloniciens" },
  { id: "2th", chapters: 3, en: "2 Thessalonians", fr: "2 Thessaloniciens" },
  { id: "1ti", chapters: 6, en: "1 Timothy", fr: "1 Timothée" },
  { id: "2ti", chapters: 4, en: "2 Timothy", fr: "2 Timothée" },
  { id: "tit", chapters: 3, en: "Titus", fr: "Tite" },
  { id: "phm", chapters: 1, en: "Philemon", fr: "Philémon" },
  { id: "heb", chapters: 13, en: "Hebrews", fr: "Hébreux" },
  { id: "jas", chapters: 5, en: "James", fr: "Jacques" },
  { id: "1pe", chapters: 5, en: "1 Peter", fr: "1 Pierre" },
  { id: "2pe", chapters: 3, en: "2 Peter", fr: "2 Pierre" },
  { id: "1jn", chapters: 5, en: "1 John", fr: "1 Jean" },
  { id: "2jn", chapters: 1, en: "2 John", fr: "2 Jean" },
  { id: "3jn", chapters: 1, en: "3 John", fr: "3 Jean" },
  { id: "jud", chapters: 1, en: "Jude", fr: "Jude" },
  { id: "rev", chapters: 22, en: "Revelation", fr: "Apocalypse" },
];

export const PLAN_DAYS = 365;
export const TOTAL_CHAPTERS = BIBLE_BOOKS.reduce((s, b) => s + b.chapters, 0);

/** A reading: from one book and chapter to another (the same book for most days). Chapters are counted from 1. */
export interface Reading {
  day: number;
  from: { book: string; chapter: number };
  to: { book: string; chapter: number };
  /** How many chapters the day holds. */
  chapters: number;
}

type Lang = "en" | "fr";

// the (book, chapter) of the n-th chapter of the Bible, n counted from 0
const CHAPTER_AT: Array<{ book: string; chapter: number }> = (() => {
  const out: Array<{ book: string; chapter: number }> = [];
  for (const b of BIBLE_BOOKS) for (let c = 1; c <= b.chapters; c++) out.push({ book: b.id, chapter: c });
  return out;
})();

const READINGS: Reading[] = (() => {
  const out: Reading[] = [];
  for (let day = 1; day <= PLAN_DAYS; day++) {
    // day d holds chapters [floor((d-1)*N/365), floor(d*N/365)): every chapter exactly once, in order, 3 or 4 a day
    const start = Math.floor(((day - 1) * TOTAL_CHAPTERS) / PLAN_DAYS);
    const end = Math.floor((day * TOTAL_CHAPTERS) / PLAN_DAYS) - 1;
    out.push({ day, from: CHAPTER_AT[start], to: CHAPTER_AT[end], chapters: end - start + 1 });
  }
  return out;
})();

const BOOK_BY_ID = new Map(BIBLE_BOOKS.map((b) => [b.id, b]));
export const bookName = (id: string, lang: Lang): string => BOOK_BY_ID.get(id)?.[lang] ?? id;

/** The reading of a day (1..365), or null for a day outside the plan. */
export function readingForDay(day: number): Reading | null {
  return Number.isInteger(day) && day >= 1 && day <= PLAN_DAYS ? READINGS[day - 1] : null;
}
export const allReadings = (): readonly Reading[] => READINGS;

/** "Genesis 1-3", "Genesis 49 - Exodus 3" (a reading can cross into the next book), "Jude" for a one-chapter book. */
export function referenceOf(r: Reading, lang: Lang): string {
  const fromBook = BOOK_BY_ID.get(r.from.book);
  const toBook = BOOK_BY_ID.get(r.to.book);
  if (!fromBook || !toBook) return "";
  const chapterOf = (b: BibleBook, c: number) => (b.chapters === 1 ? b[lang] : `${b[lang]} ${c}`);
  if (r.from.book === r.to.book) {
    if (fromBook.chapters === 1) return fromBook[lang];
    return r.from.chapter === r.to.chapter ? `${fromBook[lang]} ${r.from.chapter}` : `${fromBook[lang]} ${r.from.chapter}–${r.to.chapter}`;
  }
  return `${chapterOf(fromBook, r.from.chapter)} – ${chapterOf(toBook, r.to.chapter)}`;
}

/** The day number (1..365) of a reader whose plan started on `start` (YYYY-MM-DD, Douala), on the date `today`. Before the start it is 1; after the last day it stays 365 and `finished` is true. */
export function dayOnDate(start: string, today: string): { day: number; finished: boolean; notStarted: boolean } {
  const a = Date.parse(`${start}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return { day: 1, finished: false, notStarted: true };
  const n = Math.floor((b - a) / 86_400_000) + 1;
  if (n < 1) return { day: 1, finished: false, notStarted: true };
  if (n > PLAN_DAYS) return { day: PLAN_DAYS, finished: true, notStarted: false };
  return { day: n, finished: false, notStarted: false };
}

/** How many days in a row, ending at `day` (or at the day before it when `day` is not read yet), have been read. Today not being read yet does not break a streak. */
export function streakEndingAt(done: ReadonlySet<number>, day: number): number {
  let d = done.has(day) ? day : day - 1;
  let n = 0;
  while (d >= 1 && done.has(d)) {
    n += 1;
    d -= 1;
  }
  return n;
}
