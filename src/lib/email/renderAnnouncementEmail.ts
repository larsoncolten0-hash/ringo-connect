import { getCategory } from "@/lib/categories";

// Renders the actual HTML body sent for a community_announcements row.
// Deliberately branded as the CREATOR's message, not a generic Ringo
// newsletter — their name/avatar/category up top, their own message in the
// middle, and only the required legal/trust footer (unsubscribe, manage
// preferences, "Powered by Ringo Connect") mentions Ringo at all. See
// src/lib/email/provider.ts for how this HTML actually gets sent.
//
// English-only for now — subscribers don't have a stored locale preference
// yet (see community_subscribers; a `locale` column is a natural additive
// follow-up once this is worth localizing).
export function renderAnnouncementEmail({
  creatorName,
  creatorAvatarUrl,
  category,
  aboutLocation,
  title,
  message,
  imageUrl,
  ctaUrl,
  ctaLabel,
  manageUrl,
  unsubscribeUrl,
}: {
  creatorName: string;
  creatorAvatarUrl?: string | null;
  category?: string | null;
  aboutLocation?: string | null;
  title: string;
  message: string;
  imageUrl?: string | null;
  ctaUrl?: string | null;
  ctaLabel?: string | null;
  manageUrl: string;
  unsubscribeUrl: string;
}): string {
  const categoryLabel = getCategory(category as any)?.label.en;
  const subtitle = [categoryLabel, aboutLocation].filter(Boolean).join(" • ");
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
                ${creatorAvatarUrl ? `<img src="${esc(creatorAvatarUrl)}" alt="" width="56" height="56" style="border-radius:9999px;object-fit:cover;margin-bottom:10px;" />` : ""}
                <div style="font-size:17px;font-weight:700;color:#111827;">${esc(creatorName)}</div>
                ${subtitle ? `<div style="font-size:13px;color:#6B7280;margin-top:2px;">${esc(subtitle)}</div>` : ""}
              </td>
            </tr>
            <tr><td style="border-top:1px solid #E5E7EB;"></td></tr>
            <tr>
              <td style="padding:24px 28px;">
                <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:10px;">${esc(title)}</div>
                ${imageUrl ? `<img src="${esc(imageUrl)}" alt="" width="100%" style="border-radius:12px;margin-bottom:14px;display:block;" />` : ""}
                <div style="font-size:14px;line-height:1.6;color:#374151;white-space:pre-wrap;">${esc(message)}</div>
                ${
                  ctaUrl
                    ? `<div style="margin-top:20px;"><a href="${esc(ctaUrl)}" style="display:inline-block;background-color:#4F46E5;color:#FFFFFF;font-size:14px;font-weight:600;padding:11px 22px;border-radius:9999px;text-decoration:none;">${esc(ctaLabel || "View")}</a></div>`
                    : ""
                }
              </td>
            </tr>
            <tr><td style="border-top:1px solid #E5E7EB;"></td></tr>
            <tr>
              <td style="padding:18px 28px 24px;text-align:center;">
                <div style="font-size:11px;color:#9CA3AF;line-height:1.6;">
                  You're receiving this because you subscribed to ${esc(creatorName)}'s Ringo community.<br />
                  <a href="${esc(unsubscribeUrl)}" style="color:#6B7280;text-decoration:underline;">Unsubscribe</a>
                  &nbsp;·&nbsp;
                  <a href="${esc(manageUrl)}" style="color:#6B7280;text-decoration:underline;">Manage preferences</a>
                </div>
                <div style="font-size:10px;color:#D1D5DB;margin-top:10px;">Powered by Ringo Connect</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}
