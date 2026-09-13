import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import QRCode from "qrcode";
import { getMusicReceiptData } from "@/lib/musicReceipt";
import { formatPrice } from "@/lib/currency";
import { NextResponse } from "next/server";

// Public — same "the order id is the access control" posture as the web
// receipt page and every other guest-facing order route in this app (see
// getMusicReceiptData's own comment). Generated fresh on every request
// rather than cached/stored: it's cheap (one query + a few hundred
// milliseconds of drawing), and always reflects the order's current
// payment_status with no separate cache to invalidate when Fapshi confirms
// a payment a few seconds after this was first requested.
export const dynamic = "force-dynamic";

const MARGIN = 48;
const PAGE_WIDTH = 595.28; // A4
const PAGE_HEIGHT = 841.89;
const INK = rgb(0x14 / 255, 0x20 / 255, 0x2b / 255);
const MUTED = rgb(0x6b / 255, 0x72 / 255, 0x80 / 255);
const BORDER = rgb(0xe5 / 255, 0xe7 / 255, 0xeb / 255);

function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) || [];
  if (!m[1]) return rgb(0.95, 0.69, 0.02);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

function wrapText(font: PDFFont, text: string, maxWidth: number, fontSize: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, fontSize) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const data = await getMusicReceiptData(params.id);
  if (!data) return NextResponse.json({ error: "Order not found." }, { status: 404 });

  const pdf = await PDFDocument.create();
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const accent = hexToRgb(data.accent);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;
  const contentWidth = PAGE_WIDTH - MARGIN * 2;

  // Every drawing helper below advances `y` and, if content runs past the
  // bottom margin, starts a fresh page — a music order can have enough
  // line items (a big merch haul, several ticket tiers) that a fixed
  // single-page layout would silently clip.
  const ensureSpace = (needed: number) => {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  };

  const text = (str: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; align?: "left" | "right" | "center" } = {}) => {
    const size = opts.size ?? 10;
    const font = opts.font ?? regular;
    const color = opts.color ?? INK;
    const width = font.widthOfTextAtSize(str, size);
    let x = opts.x ?? MARGIN;
    if (opts.align === "right") x = PAGE_WIDTH - MARGIN - width;
    else if (opts.align === "center") x = (PAGE_WIDTH - width) / 2;
    page.drawText(str, { x, y, size, font, color });
  };

  const divider = () => {
    ensureSpace(20);
    y -= 6;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 1, color: BORDER });
    y -= 16;
  };

  // --- Header --------------------------------------------------------
  text("RINGO CONNECT", { size: 9, font: bold, color: MUTED, align: "center" });
  y -= 20;
  text(data.artistName, { size: 16, font: bold, align: "center" });
  y -= 26;
  text("PAYMENT RECEIPT", { size: 11, font: bold, color: accent, align: "center" });
  y -= 24;

  text(`Receipt No: ${data.receiptNumber}`, { size: 9, color: MUTED, align: "center" });
  y -= 14;
  text(`Order No: ${data.orderNumber}`, { size: 9, color: MUTED, align: "center" });
  y -= 14;
  const dateLabel = new Date(data.createdAt).toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  text(`Date: ${dateLabel}`, { size: 9, color: MUTED, align: "center" });
  y -= 10;
  divider();

  // --- Customer --------------------------------------------------------
  sectionLabel("CUSTOMER");
  text(data.customerName, { size: 12, font: bold });
  y -= 16;
  if (data.customerEmail) {
    text(data.customerEmail, { size: 10, color: MUTED });
    y -= 16;
  }
  divider();

  // --- Event -------------------------------------------------------
  if (data.event) {
    sectionLabel("EVENT");
    text(data.event.title, { size: 12, font: bold });
    y -= 16;
    const eventMeta = [data.event.date, data.event.time].filter(Boolean).join(" · ");
    if (eventMeta) {
      text(eventMeta, { size: 10, color: MUTED });
      y -= 14;
    }
    if (data.event.location) {
      text(data.event.location, { size: 10, color: MUTED });
      y -= 14;
    }
    y -= 2;
    divider();
  }

  // --- Purchase details --------------------------------------------
  sectionLabel("PURCHASE DETAILS");
  for (const line of data.items) {
    ensureSpace(30);
    const qtyLabel = line.quantity > 1 ? `${line.quantity} × ` : "";
    const label = `${qtyLabel}${line.name}`;
    const amount = formatPrice(line.lineTotal, data.currency);
    const amountWidth = regular.widthOfTextAtSize(amount, 10);
    const wrapped = wrapText(regular, label, contentWidth - amountWidth - 12, 10);
    wrapped.forEach((ln, i) => {
      text(ln, { size: 10 });
      if (i === 0) text(amount, { size: 10, align: "right" });
      y -= 14;
    });
  }
  y -= 2;
  divider();

  // --- Total ---------------------------------------------------------
  ensureSpace(60);
  text("TOTAL PAID", { size: 10, font: bold, color: MUTED });
  const totalStr = formatPrice(data.total, data.currency);
  text(totalStr, { size: 10, font: bold, align: "right" });
  y -= 30;
  const statusLabel = data.paymentStatus === "paid" ? "PAID" : "PAYMENT PROCESSING";
  const statusColor = data.paymentStatus === "paid" ? rgb(0.09, 0.64, 0.29) : rgb(0.71, 0.32, 0.04);
  text(statusLabel, { size: 11, font: bold, color: statusColor, align: "center" });
  y -= 24;
  divider();

  // --- Ticket credential(s) ------------------------------------------
  // A cancelled/refunded ticket never gets the "scan this" QR treatment
  // (see PART 26 of the spec) — only a single genuinely valid ticket does;
  // anything else (zero, several, or one that's no longer valid) falls to
  // the plain list below, same rule ReceiptPageView.tsx applies.
  const singleValidTicket = data.tickets.length === 1 && data.tickets[0].status === "valid" ? data.tickets[0] : null;
  if (data.paymentStatus === "paid" && singleValidTicket) {
    sectionLabel("YOUR EVENT TICKET");
    ensureSpace(220);
    try {
      const qrPng = await QRCode.toBuffer(
        `${(process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, "")}/m/${data.artistUsername}/ticket-pass/${singleValidTicket.code}`,
        { type: "png", errorCorrectionLevel: "H", margin: 1, width: 320, color: { dark: "#1c1c28", light: "#ffffff" } }
      );
      const qrImage = await pdf.embedPng(qrPng);
      const qrSize = 180;
      page.drawImage(qrImage, { x: (PAGE_WIDTH - qrSize) / 2, y: y - qrSize, width: qrSize, height: qrSize });
      y -= qrSize + 14;
      text("SCAN AT EVENT ENTRANCE", { size: 9, font: bold, color: MUTED, align: "center" });
      y -= 16;
      text(singleValidTicket.code, { size: 9, color: MUTED, align: "center" });
      y -= 20;
    } catch (err) {
      console.error(`receipt PDF QR generation failed for order ${params.id}:`, err);
    }
    divider();
  } else if (data.paymentStatus === "paid" && data.tickets.length > 0) {
    sectionLabel(`YOUR TICKETS (${data.tickets.length})`);
    for (const ticket of data.tickets) {
      ensureSpace(16);
      const statusNote = ticket.status !== "valid" ? ` (${ticket.status})` : "";
      text(`${ticket.ticketTypeName} — ${ticket.code}${statusNote}`, { size: 10 });
      y -= 14;
    }
    ensureSpace(20);
    text("View each ticket online for its own scannable QR code.", { size: 9, color: MUTED });
    y -= 20;
    divider();
  }

  // --- Organizer contact + footer -------------------------------------
  if (data.artistContact) {
    sectionLabel("ORGANIZER CONTACT");
    text(data.artistContact, { size: 10 });
    y -= 24;
  }

  ensureSpace(30);
  text("Thank you for your purchase.", { size: 9, color: MUTED, align: "center" });
  y -= 14;
  text("Powered by Ringo Connect", { size: 9, color: MUTED, align: "center" });

  function sectionLabel(label: string) {
    if (!label) return;
    ensureSpace(20);
    text(label, { size: 8, font: bold, color: MUTED });
    y -= 16;
  }

  const bytes = await pdf.save();
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${data.receiptNumber}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
