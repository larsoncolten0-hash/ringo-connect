// Document PDF renderer. No new dependency: pdf-lib with the standard fonts. The template is chosen by the version stamped on
// the document at issue; an unknown version is an error (never a silently different layout). Output is deterministic for a given
// model (fixed metadata dates), so a re-download of an issued document is byte-for-byte reproducible.
import { PDFDocument, StandardFonts } from "pdf-lib";
import { translations } from "@/lib/i18n/translations";
import { Sheet } from "./layout";
import { renderV1, type TemplateResult } from "./templates/v1";
import { safe } from "./layout";
import type { DocumentLabels, DocumentModel } from "../types";

type Template = (sheet: Sheet, model: DocumentModel, labels: DocumentLabels) => TemplateResult;
const TEMPLATES: Record<number, Template> = { 1: renderV1 };

export function supportedTemplateVersions(): number[] {
  return Object.keys(TEMPLATES).map(Number);
}

export async function renderDocumentPdf(model: DocumentModel): Promise<Uint8Array> {
  const template = TEMPLATES[model.templateVersion];
  if (!template) throw new Error(`unsupported document template version ${model.templateVersion}`);
  const labels = translations[model.locale === "en" ? "en" : "fr"].documents.pdf;

  const pdf = await PDFDocument.create({ updateMetadata: false });
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const sheet = new Sheet(pdf, regular, bold);

  const { watermark } = template(sheet, model, labels);
  sheet.finish({ footerLeft: labels.generatedWith, pageLabel: labels.page, watermark });

  const title = model.docType === "receipt" ? labels.receipt : labels.invoice;
  pdf.setTitle(safe(`${title} ${model.number ?? ""}`, 120));
  pdf.setProducer("Ringo Connect");
  pdf.setCreator("Ringo Connect");
  const stamp = model.issueDate ? new Date(`${model.issueDate}T00:00:00Z`) : new Date(0);
  const when = Number.isNaN(stamp.getTime()) ? new Date(0) : stamp;
  pdf.setCreationDate(when);
  pdf.setModificationDate(when);
  return pdf.save();
}

/** Never throws: a rendering problem becomes a result the route can turn into a clean 500. */
export async function renderDocumentPdfSafe(model: DocumentModel): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  try {
    return { ok: true, bytes: await renderDocumentPdf(model) };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}
