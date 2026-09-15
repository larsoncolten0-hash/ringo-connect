import Link from "next/link";
import Image from "next/image";

export const metadata = { title: "Privacy Policy — Ringo Connect" };

// See the comment in /terms/page.tsx — same reasoning for why this exists
// now. Expanded draft content, pending a lawyer's review before treating
// it as binding. Two values are still open bracketed placeholders (data
// retention period, data-transfer safeguard description) — left visible
// rather than guessed; do not fill these in without explicit confirmation
// of the real wording.
export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-ringo-bg text-ringo-text">
      <header className="border-b border-ringo-border">
        <div className="max-w-3xl mx-auto flex items-center px-5 py-4">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/logo.png" alt="Ringo Connect" width={24} height={24} className="rounded-md" />
            <span className="font-display font-medium">Ringo Connect</span>
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-5 py-12">
        <h1 className="font-display text-2xl font-medium mb-2">Privacy Policy</h1>
        <p className="text-sm text-ringo-muted mb-8">Last updated: September 15, 2026</p>

        <div className="flex flex-col gap-5 text-sm leading-relaxed text-ringo-text">
          <p>
            Ringo Connect Ltd. (Yaoundé, Cameroon) operates Ringo Connect. This page explains what personal data we
            collect, why, and what rights you have over it.
          </p>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">1. Information we collect</h2>
            <p>
              <strong>Account and page information.</strong> When you create a Ringo account, we store your email,
              password (encrypted), and the content of your page — name, bio, links, products, menu items, media you
              upload, and similar.
            </p>
            <p className="mt-2">
              <strong>Visitor analytics.</strong> We record basic click analytics on your page (which
              links/products get clicked, referrer, approximate location) so you can see what's working. This is
              aggregate/behavioral data, not sold to third parties.
            </p>
            <p className="mt-2">
              <strong>Customer and order information.</strong> When a customer places an order, makes a booking, or
              buys a ticket through your page, we store their name, phone number, email (where provided), and order
              details so the page owner can fulfill it. This information belongs to that page and is never visible
              to other Ringo creators.
            </p>
            <p className="mt-2">
              <strong>Community subscribers.</strong> If someone joins a page's Community (to receive
              announcements), we store their name, phone number, and email, along with their specific notification
              preferences. Marketing/communication consent is never assumed — it's only recorded when someone
              explicitly opts in, and they can opt out at any time via the preferences link in any message they
              receive, or by contacting us.
            </p>
            <p className="mt-2">
              <strong>Staff/team member information.</strong> If an account owner invites staff to help manage their
              business, we store the invited person's name, email, phone number, and assigned role/permissions.
            </p>
            <p className="mt-2">
              <strong>Affiliate and payout information.</strong> If you participate in our affiliate program or
              receive payouts (for example, as a musician selling tickets), we store your chosen payout method and
              the details needed to send that payout (such as a Mobile Money number).
            </p>
            <p className="mt-2">
              <strong>Device and notification information.</strong> If you enable push notifications, we store the
              technical subscription details needed to deliver them to your device.
            </p>
            <p className="mt-2">
              <strong>Payments.</strong> Subscription and certain order/ticket payments are handled by our payment
              providers (Stripe, Fapshi) — we do not store full card numbers ourselves. Payment provider credentials
              configured by Ringo Connect (for its own platform use) are encrypted at rest.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">2. Why we process this data</h2>
            <p>
              We process personal data to: operate your page and account, fulfill orders/bookings/tickets, send
              communications you've opted into, process payments and payouts, provide analytics, maintain platform
              security, and comply with legal obligations. Depending on the data involved, this is based on your
              consent, the performance of our contract with you (these Terms), or our legitimate interest in
              operating and improving the service.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">3. Who we share data with</h2>
            <p>We share data only as needed to operate the service, with these categories of processors:</p>
            <ul className="list-disc pl-5 flex flex-col gap-1 mt-2">
              <li>Fapshi — Mobile Money payment collection and payout disbursement</li>
              <li>Stripe — card payment processing</li>
              <li>Supabase — database hosting and authentication</li>
              <li>Vercel — application hosting</li>
              <li>Resend — transactional and marketing email delivery</li>
            </ul>
            <p className="mt-2">We do not sell personal data to third parties.</p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">4. International data transfer</h2>
            <p>
              Some of the providers listed above may store or process data outside Cameroon. Where this occurs, we
              take reasonable steps to ensure the data is protected consistent with Cameroonian law, including
              [DATA TRANSFER SAFEGUARD DESCRIPTION — TO BE CONFIRMED]. If a specific authorization from Cameroon's
              data protection authority is required for any of these transfers, we are in the process of confirming
              and obtaining it.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">5. Data retention</h2>
            <p>
              We retain your personal data for as long as your account remains active, and for a limited period
              afterward as needed for legal, accounting, or dispute-resolution purposes, after which it is deleted
              or anonymized. [RETENTION PERIOD — TO BE CONFIRMED]
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">6. Security</h2>
            <p>
              We use industry-standard measures to protect personal data, including encryption of passwords and of
              sensitive payment credentials at rest. No system is perfectly secure; if we become aware of a data
              breach affecting your personal data, we will notify affected users without undue delay, consistent
              with applicable law.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">7. Cookies and tracking</h2>
            <p>
              We use basic analytics to understand how your page is used. If you enable optional tracking pixels
              (such as Meta or TikTok) on your own page, those third parties' own privacy practices apply to data
              collected through those pixels — enabling them is your choice as the page owner.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">8. Children's privacy</h2>
            <p>
              Ringo Connect is not directed at children, and our Terms require account holders to meet a minimum age
              requirement. If we learn we've collected personal data from a child in violation of this, we will
              delete it.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">9. Your rights</h2>
            <p>
              Depending on applicable law, you may have the right to: access the personal data we hold about you,
              request correction of inaccurate data, request deletion of your account and associated data, object to
              certain processing, and request a copy of your data in a portable format. To exercise any of these
              rights, contact{" "}
              <a href="mailto:info@ringoconnectltd.com" className="text-ringo-indigo hover:underline">
                info@ringoconnectltd.com
              </a>
              . Once Cameroon's Data Protection Authority is operational, you may also have the right to lodge a
              complaint with it directly.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">10. Changes to this policy</h2>
            <p>
              We may update this Privacy Policy as the product or applicable law changes. Material changes will be
              announced with reasonable notice where practical.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">Contact</h2>
            <p>
              Questions about this policy, or to exercise your rights:{" "}
              <a href="mailto:info@ringoconnectltd.com" className="text-ringo-indigo hover:underline">
                info@ringoconnectltd.com
              </a>
              .
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
