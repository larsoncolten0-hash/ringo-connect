import Link from "next/link";
import Image from "next/image";

export const metadata = { title: "Privacy Policy — Ringo Connect" };

// See the comment in /terms/page.tsx — same reasoning for why this exists
// now. Describes what Ringo Connect actually collects today; have this
// reviewed by an actual lawyer before treating it as binding.
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
        <p className="text-sm text-ringo-muted mb-8">Last updated September 2026</p>

        <div className="flex flex-col gap-5 text-sm leading-relaxed text-ringo-text">
          <p>
            Ringo Connect Ltd. (Yaoundé, Cameroon) operates Ringo Connect. This page explains what information we
            collect and how it's used.
          </p>
          <section>
            <h2 className="font-display text-base font-medium mb-1.5">Account and page information</h2>
            <p>
              When you create a Ringo account, we store your email, password (encrypted), and the content of your
              page — name, bio, links, products, menu items, media you upload, and similar. This is used to run your
              page and isn't sold to third parties.
            </p>
          </section>
          <section>
            <h2 className="font-display text-base font-medium mb-1.5">Visitors to your page</h2>
            <p>
              We record basic click analytics (which links/products get clicked, referrer, approximate location) so
              you can see what's working. We do not sell visitor data.
            </p>
          </section>
          <section>
            <h2 className="font-display text-base font-medium mb-1.5">Customer information (restaurant and similar orders)</h2>
            <p>
              When a customer places an order through your page, we store their name, phone number, and order
              details so you can fulfill the order. Marketing consent (whether they agreed to receive offers) is
              stored separately and is never assumed — it's only set when a customer explicitly opts in, and they can
              opt out at any time. This information belongs to your own page and is never visible to other Ringo
              creators.
            </p>
          </section>
          <section>
            <h2 className="font-display text-base font-medium mb-1.5">Payments</h2>
            <p>Subscription payments are handled by our payment providers — we don't store full card numbers ourselves.</p>
          </section>
          <section>
            <h2 className="font-display text-base font-medium mb-1.5">Your rights</h2>
            <p>
              You can request a copy of your data or ask us to delete your account by writing to{" "}
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
