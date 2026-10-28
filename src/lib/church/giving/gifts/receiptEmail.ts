// Church giving, the money part: the receipt email for a confirmed gift. SERVER ONLY. Sent at most once (the store's claim is the guarantee), only when the donor left an email address, in the language
// the donor used. It is Ringo confirming the payment: it lists the church, the fund, the amount, the fee (none: Ringo absorbs it), the date and the reference. No tax-deduction wording: that waits until the
// law of each country has been confirmed. An anonymous gift is shown as anonymous to the church; the email only ever goes to the donor's own address.

import { sendEmail } from "@/lib/email/provider";
import { renderReceiptEmail } from "@/lib/email/renderReceiptEmail";
import { createAdminClient } from "@/lib/supabase/server";
import type { ChurchRow, GiftRow } from "./flow";
import { formatGiftReceiptNumber } from "./rules";

const TEXT = {
  en: {
    heading: "Thank you for your gift",
    subheading: (church: string) => `Your gift to ${church} was received.`,
    amount: "Amount",
    fee: "Fee",
    noFee: "None (covered by Ringo)",
    fund: "Fund",
    date: "Date",
    reference: "Reference",
    total: "Total paid",
    note: (church: string) => `This receipt confirms a payment made through Ringo Connect to ${church}.`,
    subject: (church: string) => `Your gift to ${church}`,
    care: "Care fund",
    giving: "Giving fund",
  },
  fr: {
    heading: "Merci pour votre don",
    subheading: (church: string) => `Votre don à ${church} a bien été reçu.`,
    amount: "Montant",
    fee: "Frais",
    noFee: "Aucun (pris en charge par Ringo)",
    fund: "Fonds",
    date: "Date",
    reference: "Référence",
    total: "Total payé",
    note: (church: string) => `Ce reçu confirme un paiement effectué via Ringo Connect à ${church}.`,
    subject: (church: string) => `Votre don à ${church}`,
    care: "Fonds d'entraide",
    giving: "Fonds de dons",
  },
} as const;

export async function sendChurchGiftReceiptEmail(gift: GiftRow, church: ChurchRow | null): Promise<void> {
  if (!gift.donor_email || gift.status !== "succeeded") return;
  const admin = createAdminClient();
  const { data: fund } = await admin.from("church_giving_funds").select("title_en, title_fr").eq("id", gift.fund_id).maybeSingle();
  const lang = gift.language === "fr" ? "fr" : "en";
  const n = TEXT[lang];
  const churchName = church?.name || church?.username || "";
  const amount = `${new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-US").format(gift.amount_xaf)} XAF`;
  const when = gift.confirmed_at ? new Date(gift.confirmed_at).toLocaleDateString(lang === "fr" ? "fr-FR" : "en-GB", { timeZone: "Africa/Douala" }) : "";
  const html = renderReceiptEmail({
    heading: n.heading,
    subheading: n.subheading(churchName),
    lines: [
      { label: `${n.fund}: ${(lang === "fr" ? fund?.title_fr : fund?.title_en) || (gift.fund_kind === "care" ? n.care : n.giving)}` },
      { label: n.amount, amount },
      { label: n.fee, amount: n.noFee },
      { label: n.date, amount: when },
      { label: n.reference, amount: formatGiftReceiptNumber(gift.receipt_number) ?? gift.external_id },
    ],
    total: amount,
    totalLabel: n.total,
    footerNote: n.note(churchName),
  });
  const result = await sendEmail({
    to: gift.donor_email,
    subject: n.subject(churchName),
    html,
    log: { emailType: "church_gift_receipt", resourceType: "church_gift", resourceId: gift.id },
  });
  if (!result.ok) console.error(`church gift receipt email failed for gift ${gift.id}:`, result.error);
}
