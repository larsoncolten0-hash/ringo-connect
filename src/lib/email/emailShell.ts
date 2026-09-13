// A minimal, hand-written HTML wrapper for the platform/admin emails that
// predate renderReceiptEmail.ts/renderAnnouncementEmail.ts (subscription
// payment notices, the signup-approval welcome email) — kept as-is rather
// than migrated onto those richer templates, since PHASE 1 of the email
// deliverability work this came from was scoped to swapping the sending
// mechanism only, not redesigning content. Moved out of the now-retired
// src/lib/email.ts into its own file under email/ alongside provider.ts,
// renderReceiptEmail.ts, and renderAnnouncementEmail.ts.
export function emailShell(bodyHtml: string) {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 24px; color: #0f172a;">
      <p style="font-weight: 600; font-size: 16px; letter-spacing: -0.01em; margin: 0 0 24px;">Ringo Connect</p>
      ${bodyHtml}
      <p style="margin-top: 32px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
        Ringo Connect — link-in-bio &amp; social commerce.
      </p>
    </div>
  `;
}
