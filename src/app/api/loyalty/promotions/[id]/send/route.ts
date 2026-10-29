import { loyaltyRoute } from "@/lib/retention/route";
import { sendPromotion, type Senders } from "@/lib/retention/promotions";
import { sendEmail } from "@/lib/email/provider";
import { renderAnnouncementEmail } from "@/lib/email/renderAnnouncementEmail";
import { notifyCustomer } from "@/lib/customer/inbox";

export const dynamic = "force-dynamic";

const senders = (): Senders => ({
  sendEmail: (m) => sendEmail({ to: m.to, subject: m.subject, html: m.html, replyTo: m.replyTo ?? null }),
  notifyCustomer: (id, payload, options) => notifyCustomer(id, payload, options),
  renderEmail: (m) => renderAnnouncementEmail({ creatorName: m.creatorName, title: m.title, message: m.message, ctaUrl: m.ctaUrl, ctaLabel: m.ctaLabel, manageUrl: m.manageUrl, unsubscribeUrl: m.unsubscribeUrl }),
  siteUrl: (process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com").replace(/\/$/, ""),
});

// POST { confirm: true } announces a live offer ONCE: by e-mail and push, only to customers whose effective marketing consent allows that channel. Needs loyalty.manage.
export const POST = (request: Request, { params }: { params: { id: string } }) => loyaltyRoute(request, "loyalty.manage", { body: true }, (ctx, body) => sendPromotion(ctx, params.id, body, senders()));
