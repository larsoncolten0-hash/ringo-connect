// Shared HTML shell for every transactional receipt/confirmation email in
// the app (music order, restaurant order, booking) — one branded-as-Ringo
// layout (unlike renderAnnouncementEmail, which is branded as the
// creator's own message) since a receipt is Ringo Connect confirming a
// transaction actually happened, not a message from the business itself.
// See src/lib/email/provider.ts for how this HTML actually gets sent.
export function renderReceiptEmail({
  heading,
  subheading,
  lines,
  total,
  totalLabel,
  ctaUrl,
  ctaLabel,
  footerNote,
}: {
  heading: string;
  subheading?: string | null;
  lines: { label: string; amount?: string | null }[];
  total?: string | null;
  totalLabel?: string;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  footerNote?: string | null;
}): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F3F4F6;padding:24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background-color:#FFFFFF;border-radius:16px;overflow:hidden;">
            <tr>
              <td style="padding:28px 28px 20px;text-align:center;">
                <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#9CA3AF;margin-bottom:10px;">Ringo Connect</div>
                <div style="font-size:18px;font-weight:700;color:#111827;">${esc(heading)}</div>
                ${subheading ? `<div style="font-size:13px;color:#6B7280;margin-top:4px;">${esc(subheading)}</div>` : ""}
              </td>
            </tr>
            <tr><td style="border-top:1px solid #E5E7EB;"></td></tr>
            <tr>
              <td style="padding:20px 28px;">
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;color:#374151;">
                  ${lines
                    .map(
                      (l) =>
                        `<tr><td style="padding:5px 0;">${esc(l.label)}</td><td style="padding:5px 0;text-align:right;color:#111827;">${
                          l.amount != null ? esc(l.amount) : ""
                        }</td></tr>`
                    )
                    .join("")}
                  ${
                    total != null
                      ? `<tr><td style="padding:10px 0 0;border-top:1px solid #E5E7EB;font-weight:700;color:#111827;">${esc(
                          totalLabel || "Total"
                        )}</td><td style="padding:10px 0 0;border-top:1px solid #E5E7EB;text-align:right;font-weight:700;color:#111827;">${esc(
                          total
                        )}</td></tr>`
                      : ""
                  }
                </table>
                ${
                  ctaUrl
                    ? `<div style="margin-top:22px;text-align:center;"><a href="${esc(ctaUrl)}" style="display:inline-block;background-color:#4F46E5;color:#FFFFFF;font-size:14px;font-weight:600;padding:11px 22px;border-radius:9999px;text-decoration:none;">${esc(ctaLabel || "View")}</a></div>`
                    : ""
                }
              </td>
            </tr>
            <tr><td style="border-top:1px solid #E5E7EB;"></td></tr>
            <tr>
              <td style="padding:16px 28px 22px;text-align:center;">
                <div style="font-size:11px;color:#9CA3AF;line-height:1.6;">
                  ${footerNote ? `${esc(footerNote)}<br />` : ""}
                  Sent by Ringo Connect on behalf of this business.
                </div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
