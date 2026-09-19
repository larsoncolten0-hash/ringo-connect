import Link from "next/link";
import BrandLogo from "@/components/BrandLogo";

export const metadata = { title: "Terms of Service — Ringo Connect" };

// Referenced from /auth/signup ("I agree to Ringo Connect's Terms and
// Privacy Policy") since before this page existed — that link was already
// live, just pointing nowhere. Expanded draft content, pending a lawyer's
// review before treating it as binding. No Eligibility/minimum-age section
// — deliberately omitted per instruction, not overlooked.
export default function TermsPage() {
  return (
    <div className="min-h-screen bg-ringo-bg text-ringo-text">
      <header className="border-b border-ringo-border">
        <div className="max-w-3xl mx-auto flex items-center px-5 py-4">
          <Link href="/" className="flex items-center">
            <BrandLogo variant="full" height={24} />
          </Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-5 py-12 prose-sm">
        <h1 className="font-display text-2xl font-medium mb-2">Terms of Service</h1>
        <p className="text-sm text-ringo-muted mb-8">Last updated: September 15, 2026</p>

        <div className="flex flex-col gap-5 text-sm leading-relaxed text-ringo-text">
          <p>
            These Terms govern your use of Ringo Connect ("Ringo Connect," "we," "us"), operated by Ringo Connect
            Ltd. (Yaoundé, Cameroon). By creating an account or a page, you agree to these Terms. If you don't agree,
            don't use Ringo Connect.
          </p>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">1. Your account and page</h2>
            <p>
              You're responsible for the content you publish on your Ringo page — links, products, menu items,
              media, and any other information you add. You must have the right to publish everything you upload,
              and it must not infringe anyone else's rights. You're responsible for keeping your login credentials
              secure and for all activity under your account.
            </p>
            <p className="mt-2">
              We can suspend or remove a page that violates these Terms or the law, with or without notice depending
              on severity.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">2. Prohibited use</h2>
            <p>You may not use Ringo Connect to:</p>
            <ul className="list-disc pl-5 flex flex-col gap-1 mt-2">
              <li>Sell or list illegal goods or services</li>
              <li>Engage in fraud, misrepresentation, or impersonation of another person or business</li>
              <li>Infringe intellectual property rights, or upload content you don't have the right to use</li>
              <li>Harass, threaten, or abuse any other person</li>
              <li>Send spam or unsolicited communications through the platform's messaging/notification tools</li>
              <li>Attempt to interfere with, disrupt, or gain unauthorized access to Ringo Connect's systems</li>
            </ul>
            <p className="mt-2">We may suspend or terminate accounts that violate this section.</p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">3. Content license</h2>
            <p>
              You retain ownership of the content you upload. By uploading it, you grant Ringo Connect a limited,
              non-exclusive license to host, store, display, and transmit that content as necessary to operate the
              service — for example, showing your menu to a customer, or your tracks to a fan. This license ends
              when you delete the content or close your account, except where a copy is retained for a limited
              period for legal, backup, or accounting purposes.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">4. Orders, bookings, and tickets placed through a Ringo page</h2>
            <p>
              Where a page accepts orders, bookings, or ticket sales (for example, a restaurant menu or an event),
              the resulting transaction is an agreement between the customer and that page's owner. Ringo Connect
              provides the platform and is not a party to that transaction, except where Ringo Connect explicitly
              collects payment on the owner's behalf (see Section 5).
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">5. Payments</h2>
            <p>
              <strong>Subscription payments.</strong> Subscription fees for Ringo Connect plans are processed
              through our payment providers (currently Stripe for card payments, Fapshi for Mobile Money). Plans
              paid via Mobile Money do not renew automatically — your plan remains active for the period you paid
              for, and reverts to the Free plan if not renewed. Plans paid via card may renew automatically, in
              which case you can cancel future renewals from your dashboard at any time.
            </p>
            <p className="mt-2">
              <strong>Customer payments for orders/tickets.</strong> Where a page lists cash or direct Mobile Money
              as a payment method, that reflects the page owner's own arrangement with their customer — Ringo
              Connect does not process or hold those funds. Where Ringo Connect explicitly collects payment on the
              page owner's behalf (for example, ticket and certain product purchases via Mobile Money), Ringo
              Connect deducts an agreed platform commission before disbursing the remaining balance to the page
              owner, subject to any applicable holding period disclosed at the time.
            </p>
            <p className="mt-2">
              <strong>Refunds.</strong> Subscription fees are generally non-refundable except where required by law.
              Refunds for orders, tickets, or bookings placed with a page owner are at that page owner's discretion,
              since the transaction is between the customer and the page owner per Section 4, except where Ringo
              Connect has directly collected the payment, in which case contact us at the address below.
            </p>
            <p className="mt-2">
              <strong>Price changes.</strong> We may change plan pricing or features. Changes won't apply
              retroactively to a period you've already paid for.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">6. Team members and organizations</h2>
            <p>
              An account owner may invite staff to help manage their page under a Business plan. The account owner
              is responsible for the actions of staff they invite, and for assigning appropriate permissions. Staff
              members retain their own separate personal account and are subject to these Terms individually as
              well.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">7. Affiliate program</h2>
            <p>
              Users may participate in Ringo Connect's affiliate program, earning a commission on qualifying
              referred payments, subject to the commission rate, holding period, and minimum payout thresholds shown
              in your affiliate dashboard, which may change from time to time. We may withhold or reverse commission
              earned through fraudulent, abusive, or self-referral activity.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">8. Intellectual property</h2>
            <p>
              The Ringo Connect name, logo, and software are the property of Ringo Connect Ltd. Nothing in these
              Terms grants you rights to our trademarks or branding except as needed to use the service as intended.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">9. Termination</h2>
            <p>
              You may close your account at any time from your dashboard, or by contacting us. We may suspend or
              terminate your account for violating these Terms, non-payment, or where required by law. On
              termination, your page may become unavailable to visitors; we may retain certain data as described in
              our Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">10. Disclaimer of warranties</h2>
            <p>
              Ringo Connect is provided "as is" and "as available." We don't guarantee the service will be
              uninterrupted, error-free, or fit for any specific purpose beyond what's described in these Terms.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">11. Limitation of liability</h2>
            <p>
              To the extent permitted by law, Ringo Connect Ltd. is not liable for indirect, incidental, or
              consequential damages arising from your use of the service, or for disputes between a page owner and
              their own customers.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">12. Indemnification</h2>
            <p>
              You agree to indemnify Ringo Connect Ltd. against claims arising from your content, your use of the
              service, or your violation of these Terms.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">13. Governing law</h2>
            <p>
              These Terms are governed by the laws of the Republic of Cameroon. Any dispute will be subject to the
              exclusive jurisdiction of the courts of Yaoundé, Cameroon.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">14. Changes to these Terms</h2>
            <p>
              We may update these Terms as the product changes. Continued use of Ringo Connect after an update means
              you accept the revised Terms. Material changes will be announced with reasonable notice where
              practical.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">15. General</h2>
            <p>
              If any part of these Terms is found unenforceable, the rest remains in effect. These Terms are the
              entire agreement between you and Ringo Connect Ltd. regarding your use of the service.
            </p>
          </section>

          <section>
            <h2 className="font-display text-base font-medium mb-1.5">Contact</h2>
            <p>
              Questions about these Terms:{" "}
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
