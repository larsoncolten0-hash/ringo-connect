import type { Metadata } from "next";
import LegalDocument from "@/components/legal/LegalDocument";

// English and French (the visitor's language choice, as everywhere in Ringo): the title carries both. The content is src/lib/legal/terms.*.ts.
export const metadata: Metadata = {
  title: "Terms of Service · Conditions d'utilisation — Ringo Connect",
  description: "The terms for using Ringo Connect. / Les conditions d'utilisation de Ringo Connect.",
  alternates: { canonical: "/terms" },
};

export default function TermsPage() {
  return <LegalDocument kind="terms" />;
}
