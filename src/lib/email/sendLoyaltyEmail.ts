import { sendEmail, type SendEmailResult } from "@/lib/email/provider";
import { emailShell } from "@/lib/email/emailShell";
import { buildEmail, renderEmailHtml, type LoyaltyMessage } from "@/lib/loyalty/notifyMessages";
import type { Locale } from "@/lib/i18n/translations";

// A transactional loyalty email (reward unlocked, package expiring soon) to the customer's OWN
// verified address, in their language. Same one-small-function-per-email pattern and the same
// sendEmail()/emailShell as every other Ringo email. Deliberately NOT passed `log:` so no
// per-recipient delivery row is written for what is a private notification; never marketing.
export async function sendLoyaltyEmail(to: string, message: LoyaltyMessage, locale: Locale): Promise<SendEmailResult> {
  const email = buildEmail(message, locale);
  if (!email) return { ok: false, error: "no_email_for_kind" };
  return sendEmail({ to, subject: email.subject, html: emailShell(renderEmailHtml(email)) });
}
