// What a payment reminder SAYS, in the invoice's own language. Pure: no database, no network. Used by the manual email flow, the cron and the
// manual WhatsApp preparation, so all three read the same.
//
// Wording rules: it never claims Ringo verified anything or that payment is confirmed; the amount is "the Amount Due on the invoice";
// the email says it is sent on behalf of the business; the WhatsApp text is only ever a draft the owner sends themselves.
import { translations } from "@/lib/i18n/translations";
import { currencyMinorDigits, parseMinor } from "@/lib/bookkeeping/money";
import { formatDateKey, formatMoney } from "@/lib/documents/moneyFormat";
import { emailShell } from "@/lib/email/emailShell";

export type ReminderContext = {
  reminder_id: string;
  number: string | null;
  locale: "en" | "fr";
  currency: string;
  amount_due: string; // exact decimal text from the database
  due_date: string | null;
  kind: "before_due" | "due_today" | "overdue" | "manual";
  days_overdue: number;
  to: string | null;
  phone: string | null;
  customer_name: string | null;
  seller_name: string | null;
  reply_to: string | null;
};

export const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const loc = (c: ReminderContext): "en" | "fr" => (c.locale === "en" ? "en" : "fr");

/** "5000.000" in XAF -> "5 000 FCFA" (fr) / "FCFA 5,000" (en). Exact: parsed from the decimal text, never through floating point. */
export function amountText(c: Pick<ReminderContext, "amount_due" | "currency" | "locale">): string {
  const minor = parseMinor(c.amount_due, currencyMinorDigits(c.currency));
  return minor === null ? `${c.amount_due} ${c.currency}` : formatMoney(minor, c.currency, c.locale === "en" ? "en" : "fr");
}

export function reminderSubject(c: ReminderContext): string {
  const e = translations[loc(c)].receivables.email;
  return e.subject(c.number ?? "", c.seller_name ?? "");
}

/** The state note: upcoming / due today / overdue, derived from the claimed facts (not from the kind alone). */
function timingNote(c: ReminderContext): string | null {
  const e = translations[loc(c)].receivables.email;
  if (c.days_overdue > 0) return e.noteOverdue(c.days_overdue);
  if (!c.due_date) return null;
  if (c.kind === "due_today") return e.noteDueToday;
  return e.noteUpcoming(formatDateKey(c.due_date, loc(c)));
}

/** The reminder email. `link` is ONLY ever a link the owner supplied for a manual reminder; automatic reminders always pass null. */
export function renderReminderEmail(c: ReminderContext, link: string | null): { subject: string; html: string } {
  const e = translations[loc(c)].receivables.email;
  const seller = c.seller_name ?? "";
  const row = (label: string, value: string) =>
    `<tr><td style="padding: 6px 12px 6px 0; color: #64748b; font-size: 14px;">${escapeHtml(label)}</td><td style="padding: 6px 0; font-size: 14px; font-weight: 600;">${escapeHtml(value)}</td></tr>`;
  const note = timingNote(c);
  const body = `
    <p style="font-size: 15px;">${escapeHtml(e.greeting(c.customer_name ?? ""))}</p>
    <p style="font-size: 15px;">${escapeHtml(e.intro(seller))}</p>
    <table style="border-collapse: collapse; margin: 12px 0 8px;">
      ${row(e.invoiceLabel, c.number ?? "")}
      ${row(e.amountDueLabel, amountText(c))}
      ${c.due_date ? row(e.dueDateLabel, formatDateKey(c.due_date, loc(c))) : ""}
    </table>
    ${note ? `<p style="font-size: 14px;">${escapeHtml(note)}</p>` : ""}
    ${link ? `<p style="margin: 16px 0;"><a href="${escapeHtml(link)}" style="display: inline-block; background: #1f2a44; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-size: 14px;">${escapeHtml(e.viewInvoice)}</a></p>` : ""}
    <p style="font-size: 14px;">${escapeHtml(e.alreadyPaid)}</p>
    ${c.reply_to ? `<p style="font-size: 14px;">${escapeHtml(e.replyHint(seller))}</p>` : ""}
    <p style="font-size: 12px; color: #64748b;">${escapeHtml(e.onBehalf(seller))}</p>`;
  return { subject: reminderSubject(c), html: emailShell(body) };
}

/** The WhatsApp draft (text + click-to-chat link). Needs an international-digit phone. The OWNER sends it; Ringo never does. */
export function buildWhatsAppReminder(c: ReminderContext, link: string | null): { text: string; href: string } | null {
  if (!c.phone || !/^[0-9]{7,15}$/.test(c.phone)) return null;
  const w = translations[loc(c)].receivables.wa;
  const due = c.due_date ? formatDateKey(c.due_date, loc(c)) : null;
  const text = w.message(c.customer_name ?? "", c.seller_name ?? "", c.number ?? "", amountText(c), due, link);
  return { text, href: `https://wa.me/${c.phone}?text=${encodeURIComponent(text)}` };
}

export function overdueAlertText(c: ReminderContext): { title: string; body: string } {
  const n = translations[loc(c)].receivables.notify;
  return { title: n.overdueTitle(c.number ?? ""), body: n.overdueBody(c.customer_name ?? "", amountText(c)) };
}
