import type { Metadata } from "next";
import LegalDocument from "@/components/legal/LegalDocument";

// English and French (the visitor's language choice, as everywhere in Ringo): the title carries both. The content is src/lib/legal/privacy.*.ts.
export const metadata: Metadata = {
  title: "Privacy Policy · Politique de confidentialité — Ringo Connect",
  description: "How Ringo Connect collects, uses and protects personal information. / Comment Ringo Connect collecte, utilise et protège les informations personnelles.",
  alternates: { canonical: "/privacy" },
};

export default function PrivacyPage() {
  return <LegalDocument kind="privacy" />;
}
