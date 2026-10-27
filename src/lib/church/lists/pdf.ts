import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";

// A church list (members, leadership, groups) as a PDF. Pure: it receives the rows and the words, returns the bytes. No I/O and no data of its own.
//
// The text is drawn in a standard PDF font (nothing is embedded or downloaded), which covers English and French. A character the font cannot draw is shown as "?" instead of failing, so a name with
// an unusual letter never prevents the list from being produced. Long text is cut with "..." to fit its column: a row is always one line, so a list stays easy to scan and to print.
// Every page carries the church's name, the date and "Page x of y", and the footer says the list is confidential: it holds the people of a church, and who belongs to a church is private information.

export interface PdfColumn {
  header: string;
  /** Share of the table's width (the shares are normalised). */
  weight: number;
  align?: "left" | "right";
}
export interface PdfListInput {
  title: string;
  church: string;
  /** Printed under the title, e.g. "27 October 2026". */
  dateLabel: string;
  /** Short facts printed above the table, e.g. [["Members", "120"], ["Adults", "90"]]. */
  summary: Array<[string, string]>;
  columns: PdfColumn[];
  rows: string[][];
  emptyText: string;
  footerNote: string;
  pageLabel: (n: number, total: number) => string;
}

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 40;
const ROW_H = 17;
const HEAD_H = 22;

/** Keeps only characters the font can draw (everything else becomes "?"), folds whitespace, and removes control characters. */
export function pdfSafe(text: string, font: PDFFont): string {
  const set = new Set(font.getCharacterSet());
  let out = "";
  for (const ch of String(text ?? "").replace(/\s+/g, " ").trim()) {
    const cp = ch.codePointAt(0) as number;
    if (cp < 32 || cp === 127) continue;
    out += set.has(cp) ? ch : "?";
  }
  return out;
}

/** Cuts `text` with "..." so it fits `width` points at `size`. */
export function fit(text: string, font: PDFFont, size: number, width: number): string {
  if (font.widthOfTextAtSize(text, size) <= width) return text;
  const dots = "...";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (font.widthOfTextAtSize(text.slice(0, mid) + dots, size) <= width) lo = mid;
    else hi = mid - 1;
  }
  return lo <= 0 ? dots : text.slice(0, lo).trimEnd() + dots;
}

/** How many table rows fit on the first page and on each later one (the first page also carries the title and the summary). */
export function rowsPerPage(summaryLines: number): { first: number; rest: number } {
  const usable = A4[1] - MARGIN * 2 - 24;
  const firstHead = 62 + summaryLines * 14 + 14;
  return { first: Math.max(1, Math.floor((usable - firstHead - HEAD_H) / ROW_H)), rest: Math.max(1, Math.floor((usable - HEAD_H) / ROW_H)) };
}

export function pageCount(rowCount: number, summaryLines: number): number {
  const p = rowsPerPage(summaryLines);
  return rowCount <= p.first ? 1 : 1 + Math.ceil((rowCount - p.first) / p.rest);
}

export async function buildListPdf(input: PdfListInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(pdfSafe(`${input.title} - ${input.church}`, await doc.embedFont(StandardFonts.Helvetica)));
  doc.setProducer("Ringo Connect");
  doc.setCreator("Ringo Connect");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const ink = rgb(0.1, 0.09, 0.07);
  const muted = rgb(0.4, 0.38, 0.35);
  const line = rgb(0.82, 0.8, 0.76);
  const tableW = A4[0] - MARGIN * 2;
  const totalWeight = input.columns.reduce((s, c) => s + c.weight, 0) || 1;
  const widths = input.columns.map((c) => (c.weight / totalWeight) * tableW);
  const per = rowsPerPage(input.summary.length);
  const total = pageCount(input.rows.length, input.summary.length);
  const safe = (t: string, f: PDFFont) => pdfSafe(t, f);

  const header = (page: PDFPage, y: number) => {
    let x = MARGIN;
    input.columns.forEach((c, i) => {
      const t = fit(safe(c.header, bold), bold, 8.5, widths[i] - 8);
      const w = bold.widthOfTextAtSize(t, 8.5);
      page.drawText(t, { x: c.align === "right" ? x + widths[i] - 4 - w : x + 4, y: y - 14, size: 8.5, font: bold, color: muted });
      x += widths[i];
    });
    page.drawLine({ start: { x: MARGIN, y: y - HEAD_H + 3 }, end: { x: MARGIN + tableW, y: y - HEAD_H + 3 }, thickness: 0.8, color: ink });
    return y - HEAD_H;
  };

  let idx = 0;
  for (let p = 0; p < total; p++) {
    const page = doc.addPage(A4);
    let y = A4[1] - MARGIN;
    if (p === 0) {
      page.drawText(fit(safe(input.title, bold), bold, 18, tableW), { x: MARGIN, y: y - 18, size: 18, font: bold, color: ink });
      page.drawText(fit(safe(`${input.church} - ${input.dateLabel}`, regular), regular, 10, tableW), { x: MARGIN, y: y - 36, size: 10, font: regular, color: muted });
      y -= 62;
      for (const [k, v] of input.summary) {
        page.drawText(fit(safe(v === "" ? k : `${k}: ${v}`, regular), regular, 10, tableW), { x: MARGIN, y: y - 10, size: 10, font: regular, color: ink });
        y -= 14;
      }
      y -= 14;
    } else {
      page.drawText(fit(safe(`${input.title} - ${input.church}`, regular), regular, 9, tableW), { x: MARGIN, y: y - 10, size: 9, font: regular, color: muted });
      y -= 24;
    }
    y = header(page, y);
    const take = p === 0 ? per.first : per.rest;
    const slice = input.rows.slice(idx, idx + take);
    idx += slice.length;
    if (p === 0 && input.rows.length === 0) {
      page.drawText(fit(safe(input.emptyText, regular), regular, 10, tableW), { x: MARGIN + 4, y: y - 14, size: 10, font: regular, color: muted });
    }
    slice.forEach((cells, r) => {
      const top = y - r * ROW_H;
      if (r % 2 === 1) page.drawRectangle({ x: MARGIN, y: top - ROW_H + 3, width: tableW, height: ROW_H, color: rgb(0.965, 0.955, 0.94) });
      let x = MARGIN;
      input.columns.forEach((c, i) => {
        const t = fit(safe(cells[i] ?? "", regular), regular, 9, widths[i] - 8);
        const w = regular.widthOfTextAtSize(t, 9);
        page.drawText(t, { x: c.align === "right" ? x + widths[i] - 4 - w : x + 4, y: top - 12, size: 9, font: regular, color: ink });
        x += widths[i];
      });
    });
    page.drawLine({ start: { x: MARGIN, y: MARGIN - 6 }, end: { x: MARGIN + tableW, y: MARGIN - 6 }, thickness: 0.5, color: line });
    page.drawText(fit(safe(input.footerNote, regular), regular, 7.5, tableW * 0.7), { x: MARGIN, y: MARGIN - 18, size: 7.5, font: regular, color: muted });
    const label = safe(input.pageLabel(p + 1, total), regular);
    page.drawText(label, { x: MARGIN + tableW - regular.widthOfTextAtSize(label, 7.5), y: MARGIN - 18, size: 7.5, font: regular, color: muted });
  }
  return doc.save();
}
