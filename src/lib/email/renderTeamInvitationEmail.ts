import { emailShell } from "@/lib/email/emailShell";

// Sent only for method='manual' invitations that included an email address
// (see /api/team/invitations/route.ts) — a method='link' invitation is
// never emailed automatically, matching the spec: the manager shares that
// link manually (copy/WhatsApp/etc.), Ringo never sends it on their behalf
// unless an email address was actually provided.
export function renderTeamInvitationEmail(input: {
  organizationName: string;
  roleName: string;
  inviteUrl: string;
  inviteeName: string;
}) {
  return emailShell(`
    <p style="font-size: 15px; margin: 0 0 16px;">Hi ${escapeHtml(input.inviteeName)},</p>
    <p style="font-size: 15px; margin: 0 0 16px;">
      You've been invited to join <strong>${escapeHtml(input.organizationName)}</strong> on Ringo Connect as
      <strong>${escapeHtml(input.roleName)}</strong>.
    </p>
    <p style="margin: 24px 0;">
      <a href="${input.inviteUrl}" style="display: inline-block; background: #4F46E5; color: #ffffff; font-weight: 600; font-size: 14px; padding: 12px 20px; border-radius: 999px; text-decoration: none;">
        Join ${escapeHtml(input.organizationName)}
      </a>
    </p>
    <p style="font-size: 13px; color: #64748b; margin: 0;">
      If the button doesn't work, copy and paste this link into your browser:<br />
      <span style="word-break: break-all;">${input.inviteUrl}</span>
    </p>
  `);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}
