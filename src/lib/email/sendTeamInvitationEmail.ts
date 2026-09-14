import { sendEmail } from "@/lib/email/provider";
import { renderTeamInvitationEmail } from "@/lib/email/renderTeamInvitationEmail";

export async function sendTeamInvitationEmail(input: {
  to: string;
  organizationName: string;
  roleName: string;
  inviteUrl: string;
  inviteeName: string;
  invitationId: string;
}) {
  return sendEmail({
    to: input.to,
    subject: `You're invited to join ${input.organizationName} on Ringo Connect`,
    html: renderTeamInvitationEmail(input),
    log: { emailType: "team_invitation", resourceType: "organization_invitation", resourceId: input.invitationId },
  });
}
