import type { Metadata } from "next";
import LegalDocument from "@/components/legal/LegalDocument";

// English and French (the visitor's language choice, as everywhere in Ringo): the title carries both. The content is src/lib/legal/cookies.*.ts.
export const metadata: Metadata = {
  title: "Cookie Policy · Politique relative aux cookies — Ringo Connect",
  description: "The cookies and browser storage Ringo Connect uses. / Les cookies et le stockage du navigateur utilisés par Ringo Connect.",
  alternates: { canonical: "/cookies" },
};

export default function CookiesPage() {
  return <LegalDocument kind="cookies" />;
}
