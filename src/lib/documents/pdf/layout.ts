// Layout primitives for the document PDFs (pdf-lib, standard fonts only). Everything drawn here must already have gone through
// toPdfText(); the try/catch fallbacks below are a second line of defence so a rendering problem can never take the request down.
import { PDFDocument, degrees, rgb, type Color, type PDFFont, type PDFPage } from "pdf-lib";
import { toPdfText } from "../pdfText";

export const PAGE_W = 595.28; // A4
export const PAGE_H = 841.89;
export const MARGIN = 48;
export const FOOTER_H = 34;
export const CONTENT_W = PAGE_W - MARGIN * 2;

export const INK = rgb(0x14 / 255, 0x20 / 255, 0x2b / 255);
export const MUTED = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
export const BORDER = rgb(0xe5 / 255, 0xe7 / 255, 0xeb / 255);
export const ACCENT = rgb(0x1f / 255, 0x2a / 255, 0x44 / 255);
export const SOFT = rgb(0xf3 / 255, 0xf4 / 255, 0xf6 / 255);

export function textWidth(font: PDFFont, size: number, text: string): number {
  try {
    return font.widthOfTextAtSize(text, size);
  } catch {
    return text.length * size * 0.6; // conservative estimate; drawing will fall back to ASCII below
  }
}

/** Width-based wrapping. Honors "\n", and hard-breaks a token that cannot fit on a line by itself (URLs, very long names). */
export function wrapText(font: PDFFont, size: number, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    if (para === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of para.split(" ")) {
      let w = word;
      while (w.length > 0 && textWidth(font, size, w) > maxWidth) {
        let n = w.length;
        while (n > 1 && textWidth(font, size, w.slice(0, n)) > maxWidth) n--;
        if (current) {
          lines.push(current);
          current = "";
        }
        lines.push(w.slice(0, n));
        w = w.slice(n);
      }
      if (w === "") continue;
      const candidate = current ? `${current} ${w}` : w;
      if (current && textWidth(font, size, candidate) > maxWidth) {
        lines.push(current);
        current = w;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function fitWithEllipsis(font: PDFFont, size: number, text: string, maxWidth: number): string {
  let t = text;
  while (t.length > 0 && textWidth(font, size, `${t}…`) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

export type DrawOpts = { x?: number; size?: number; font?: PDFFont; color?: Color; align?: "left" | "right" | "center"; width?: number };

export class Sheet {
  pages: PDFPage[] = [];
  page!: PDFPage;
  y = 0;

  constructor(public pdf: PDFDocument, public regular: PDFFont, public bold: PDFFont) {
    this.newPage();
  }

  newPage(): PDFPage {
    this.page = this.pdf.addPage([PAGE_W, PAGE_H]);
    this.pages.push(this.page);
    this.y = PAGE_H - MARGIN;
    return this.page;
  }

  get bottom(): number {
    return MARGIN + FOOTER_H;
  }

  /** Starts a new page (and runs `onNewPage`, e.g. to repeat a table header) when `needed` points would not fit. */
  ensure(needed: number, onNewPage?: () => void): void {
    if (this.y - needed < this.bottom) {
      this.newPage();
      onNewPage?.();
    }
  }

  gap(n: number): void {
    this.y -= n;
  }

  rule(color: Color = BORDER): void {
    this.page.drawLine({ start: { x: MARGIN, y: this.y }, end: { x: PAGE_W - MARGIN, y: this.y }, thickness: 0.75, color });
  }

  /** One line at `yTop` (default: the cursor); does not move the cursor. Text must already be safe. */
  draw(text: string, o: DrawOpts = {}, yTop: number = this.y): void {
    if (!text) return;
    const size = o.size ?? 10;
    const font = o.font ?? this.regular;
    const width = textWidth(font, size, text);
    const base = o.x ?? MARGIN;
    let x = base;
    if (o.align === "right") x = base + (o.width ?? 0) - width;
    else if (o.align === "center") x = base + ((o.width ?? 0) - width) / 2;
    const args = { x, y: yTop - size, size, font, color: o.color ?? INK };
    try {
      this.page.drawText(text, args);
    } catch {
      try {
        this.page.drawText(text.replace(/[^\x20-\x7e]/g, "?"), args);
      } catch {
        // never fail a whole document over one string
      }
    }
  }

  /** Wrapped paragraph that flows across pages. Returns the number of lines drawn. */
  para(text: string, o: DrawOpts & { lineHeight?: number; maxLines?: number; onNewPage?: () => void } = {}): number {
    if (!text) return 0;
    const size = o.size ?? 10;
    const font = o.font ?? this.regular;
    const width = o.width ?? CONTENT_W;
    const lh = o.lineHeight ?? size * 1.4;
    let lines = wrapText(font, size, text, width);
    if (o.maxLines && lines.length > o.maxLines) {
      lines = lines.slice(0, o.maxLines);
      lines[o.maxLines - 1] = fitWithEllipsis(font, size, lines[o.maxLines - 1], width);
    }
    for (const line of lines) {
      this.ensure(lh, o.onNewPage);
      this.draw(line, { ...o, size, font, width }, this.y);
      this.y -= lh;
    }
    return lines.length;
  }

  /** Footer and page numbers on every page, plus an optional diagonal watermark (draft / void). Call once, last. */
  finish(opts: { footerLeft: string; pageLabel: (n: number, total: number) => string; watermark?: string | null }): void {
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      this.page = p;
      if (opts.watermark) {
        try {
          p.drawText(opts.watermark, { x: 130, y: 250, size: 96, font: this.bold, color: rgb(0.9, 0.9, 0.92), rotate: degrees(40) });
        } catch {
          // decorative only
        }
      }
      p.drawLine({ start: { x: MARGIN, y: MARGIN + FOOTER_H - 10 }, end: { x: PAGE_W - MARGIN, y: MARGIN + FOOTER_H - 10 }, thickness: 0.5, color: BORDER });
      this.draw(opts.footerLeft, { size: 8, color: MUTED }, MARGIN + FOOTER_H - 16);
      this.draw(opts.pageLabel(i + 1, total), { size: 8, color: MUTED, align: "right", x: MARGIN, width: CONTENT_W }, MARGIN + FOOTER_H - 16);
    });
  }
}

export function safe(input: unknown, maxLength?: number, multiline = false): string {
  return toPdfText(input, { maxLength, multiline });
}
