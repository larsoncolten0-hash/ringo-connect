import Link from "next/link";
import Image from "next/image";

export const metadata = { title: "Terms of Service — Ringo Connect" };

// Referenced from /auth/signup ("I agree to Ringo Connect's Terms and
// Privacy Policy") since before this page existed — that link was already
// live, just pointing nowhere. Plain boilerplate covering what Ringo
// Connect actually does today; have this reviewed by an actual lawyer
// before treating it as binding.
export default function TermsPage() {
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
      <main className="max-w-3xl mx-auto px-5 py-12 prose-sm">
        <h1 className="font-display text-2xl font-medium mb-2">Terms of Service</h1>
        <p className="text-sm text-ringo-muted mb-8">Last updated September 2026</p>

        <div className="flex flex-col gap-5 text-sm leading-relaxed text-ringo-text">
          <p>
            These Terms govern your use of Ringo Connect, operated by Ringo Connect Ltd. (Yaoundé, Cameroon). By
            creating an account or a page, you agree to these Terms.
          </p>
          <section>
            <h2 className="font-display text-base font-medium mb-1.5">Your account and page</h2>
            <p>
              You're responsible for the content you publish on your Ringo page — links, products, menu items, media,
              and any other information you add. You must have the right to publish everything you upload. We can
              suspend a page that violates these Terms or the law.
            </p>
          </section>
          <section>
            <h2 className="font-display text-base font-medium mb-1.5">Orders placed through a Ringo page</h2>
            <p>
              Where a page accepts orders (for example, a restaurant menu), the order is an agreement between the
              customer and that page's owner — Ringo Connect provides the platform, not the goods or services being
              ordered, and is not a party to that transaction.
            </p>
          </section>
          <section>
            <h2 className="font-display text-base font-medium mb-1.5">Payments</h2>
            <p>
              Subscription payments for Ringo Connect plans are processed through our payment providers. Where a page
              lists a payment method for customer orders (cash, Mobile Money, card), that reflects how the page owner
              intends to collect payment directly — Ringo Connect does not process those customer payments on the
              owner's behalf unless explicitly stated otherwise.
            </p>
          </section>
          <section>
            <h2 className="font-display text-base font-medium mb-1.5">Changes</h2>
            <p>We may update these Terms as the product changes. Continued use of Ringo Connect after an update means you accept the revised Terms.</p>
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
