import { NUMBER_PREFIX, type DocumentType } from "./constants";

// `INV-2026-0001` / `RCT-2026-0001`: per business, per type, per year. The number is assigned by the database at issue
// (drafts consume none). This formatter mirrors the SQL function bk_doc_number(); a test keeps them identical.
export function formatDocumentNumber(type: DocumentType, year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 2999) throw new Error("formatDocumentNumber: invalid year");
  if (!Number.isInteger(seq) || seq < 1) throw new Error("formatDocumentNumber: invalid sequence");
  return `${NUMBER_PREFIX[type]}-${year}-${String(seq).padStart(4, "0")}`; // grows past 4 digits, never truncates
}

export function parseDocumentNumber(value: string): { type: DocumentType; year: number; seq: number } | null {
  const m = /^(INV|RCT)-(\d{4})-(\d{4,})$/.exec(value);
  if (!m) return null;
  return { type: m[1] === "INV" ? "invoice" : "receipt", year: Number(m[2]), seq: Number(m[3]) };
}
