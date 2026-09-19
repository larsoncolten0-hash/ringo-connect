import { sendEmail } from "@/lib/email/provider";
import { emailShell } from "@/lib/email/emailShell";
import { translations } from "@/lib/i18n/translations";

// The passwordless sign-in code for a Ringo customer (see
// src/lib/customer/codes.ts). Deliberately NOT passed `log:` — that would
// record the send in email_delivery_logs, and this email's body contains
// the one-time code itself.
export async function sendCustomerVerificationEmail(to: string, code: string, locale: "en" | "fr") {
  const copy = translations[locale].connect.email;
  return sendEmail({
    to,
    subject: copy.subject,
    html: emailShell(`
      <p style="font-size:15px; font-weight:600; margin:0 0 8px;">${copy.heading}</p>
      <p style="font-size:14px; margin:0 0 16px;">${copy.body}</p>
      <p style="font-size:32px; font-weight:700; letter-spacing:8px; margin:0 0 16px; font-family: ui-monospace, Menlo, Consolas, monospace;">${code}</p>
      <p style="font-size:13px; color:#475569; margin:0 0 8px;">${copy.expires}</p>
      <p style="font-size:13px; color:#475569; margin:0;">${copy.ignore}</p>
    `),
  });
}
