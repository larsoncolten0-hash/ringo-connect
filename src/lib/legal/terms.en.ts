import type { LegalDoc } from "./types";

// Describes the platform as it is today (not planned features). Where a legal or business fact cannot be established from the product itself, the text stays general instead of inventing a rule
// (no minimum age, refund guarantee, tax rule, commission rate or protection timeframe is stated).
export const termsEn: LegalDoc = {
  title: "Terms of Service",
  description: "The terms for using Ringo Connect: accounts, pages, content, commerce, payments, Ringo Protection, programs and more.",
  updated: "October 8, 2026",
  intro: [
    "These Terms govern your use of Ringo Connect (“Ringo”, “we”, “us”), operated by Ringo Connect Ltd. (Yaoundé, Cameroon). By creating an account or a page, or by using Ringo, you agree to these Terms and to our Privacy Policy. If you do not agree, please do not use Ringo.",
    "Ringo is a platform: page owners (creators, artists, businesses) build a public page, and their visitors and customers use it. These Terms cover both, and explain who is responsible for what.",
  ],
  sections: [
    {
      id: "acceptance",
      title: "1. Acceptance",
      blocks: [
        { p: "Using Ringo means you accept these Terms as they apply to you (as a page owner, a team member, a visitor, a customer, an affiliate or ambassador). If you use Ringo for a business, you confirm you can accept these Terms on its behalf." },
      ],
    },
    {
      id: "eligibility",
      title: "2. Eligibility",
      blocks: [
        { p: "You may use Ringo only if you can lawfully enter into these Terms where you live and you are not barred from using the service." },
      ],
    },
    {
      id: "accounts",
      title: "3. Accounts",
      blocks: [
        { p: "You need an account to create a page and use the dashboard. Give accurate information and keep it up to date. Each account is for the person or business that created it, and you may not impersonate anyone else." },
      ],
    },
    {
      id: "account-security",
      title: "4. Account security",
      blocks: [
        { p: "You are responsible for keeping your sign-in details secure and for everything done under your account, including by team members you invite and the permissions you give them. Tell us promptly if you think your account has been misused." },
      ],
    },
    {
      id: "public-profiles",
      title: "5. Public profiles",
      blocks: [
        { p: "A Ringo page is public. You decide what appears on it, and you are responsible for it. Pages are reachable by link, QR code and Ringo Connect Smart Card, and may appear in search engines." },
      ],
    },
    {
      id: "user-content",
      title: "6. Your content",
      blocks: [
        { p: "You keep ownership of what you upload or publish. You are responsible for it, you must have the right to publish it, and it must not infringe anyone else's rights or break the law." },
        { p: "You give Ringo a limited, non-exclusive licence to host, store, display, transmit and format your content as needed to run the service (for example, showing your menu to a customer or your tracks to a fan, and resizing images for faster delivery). The licence ends when you delete the content or close your account, except for copies we keep for a limited time for legal, backup, security or accounting reasons." },
      ],
    },
    {
      id: "links-third-party",
      title: "7. Links and third-party services",
      blocks: [
        { p: "Pages can link to other websites and services. Ringo does not control them and is not responsible for them. When you use a third-party service through Ringo (for example WhatsApp, a payment provider or a social network), that service's own terms apply to you." },
      ],
    },
    {
      id: "music-copyright",
      title: "8. Music and copyright",
      blocks: [
        { p: "If you sell or share music on Ringo, you confirm that you own it or have all the rights needed, including to sell it and to receive payment for it, and that it does not infringe anyone's rights. Visitors can hear a short preview before buying. Ringo gives buyers no rights beyond those the artist has the right to give; unless the artist says otherwise, buyers should treat purchases as for personal listening." },
        { p: "If you believe content on Ringo infringes your rights, contact us at info@ringoconnectltd.com with enough detail for us to find and assess it. We may remove content and suspend accounts that repeatedly infringe." },
      ],
    },
    {
      id: "digital-products",
      title: "9. Digital products",
      blocks: [
        { p: "Page owners may sell digital files. The seller is responsible for the file, for having the right to sell it and for describing it accurately. Buyers receive access to what they bought after payment is confirmed." },
      ],
    },
    {
      id: "physical-products",
      title: "10. Physical products",
      blocks: [
        { p: "Page owners may list physical products. The page owner is the seller: they are responsible for the product, its description and price, delivery, returns, taxes and compliance with the laws that apply to the sale." },
      ],
    },
    {
      id: "commerce",
      title: "11. Commerce",
      blocks: [
        { p: "Ringo provides the tools; the sale itself is an agreement between the customer and the page owner. Ringo is not the seller and is not a party to that agreement, except where these Terms say Ringo collects a payment on the owner's behalf or provides Ringo Protection." },
      ],
    },
    {
      id: "orders",
      title: "12. Orders",
      blocks: [
        { p: "Orders placed through a page are sent to the page owner, who decides whether and how to fulfil them. Customers should check what they are ordering before paying. Ringo can send confirmations and receipts but does not guarantee any seller's performance." },
      ],
    },
    {
      id: "inventory",
      title: "13. Inventory",
      blocks: [
        { p: "Stock levels are managed by the page owner. Items may be held briefly while a customer completes checkout and released if it is not completed. An item can sell out, and we cannot guarantee that stock shown is always exactly current." },
      ],
    },
    {
      id: "payments",
      title: "14. Payments",
      blocks: [
        { p: "**Subscriptions.** Plan fees are processed by our payment providers (currently Stripe for cards and Fapshi for Mobile Money). Plans paid by Mobile Money do not renew automatically: the plan stays active for the period paid and reverts to the Free plan if not renewed. Plans paid by card may renew automatically, and you can cancel future renewals from your dashboard." },
        { p: "**Customer payments.** Where a page lists cash or direct Mobile Money, that is the page owner's own arrangement with their customer and Ringo does not handle those funds. Where Ringo collects payment on the owner's behalf (for example for tickets, music and certain product purchases through Mobile Money or card), Ringo deducts an agreed platform commission and pays the balance to the page owner, subject to the conditions that apply to that payout." },
        { p: "**Price changes.** We may change plan prices or features. Changes do not affect a period you have already paid for." },
      ],
    },
    {
      id: "refunds",
      title: "15. Refunds and cancellations",
      blocks: [
        { p: "Subscription fees are generally non-refundable, except where the law requires otherwise. For orders, tickets and bookings with a page owner, refunds and cancellations are decided by that page owner, because the sale is between the customer and the owner. Where Ringo collected the payment, or where Ringo Protection applies, contact us at info@ringoconnectltd.com. Nothing in these Terms limits any consumer rights that cannot be excluded by law." },
      ],
    },
    {
      id: "ringo-protection",
      title: "16. Ringo Protection",
      blocks: [
        { p: "Ringo Protection is an optional protection for certain shop orders, available when a page offers it at checkout, for an additional fee shown before payment. The payment is held until the customer confirms they received the order or until an automatic release date passes, and is then released to the seller. If there is a problem, the customer can open a dispute while the payment is still protected, and Ringo reviews it and decides whether the payment is released to the seller or refunded to the customer. If a refund is decided, Ringo arranges it." },
      ],
    },
    {
      id: "restaurants",
      title: "17. Restaurants",
      blocks: [
        { p: "Restaurant pages can show a menu and accept orders. The restaurant is responsible for its menu, prices, preparation, food safety, delivery or service, and for complying with the laws that apply to its business." },
      ],
    },
    {
      id: "events",
      title: "18. Events",
      blocks: [
        { p: "Event organisers are responsible for their events, including information given, safety, permits, changes and cancellations. Ringo is not the organiser of events listed on pages." },
      ],
    },
    {
      id: "tickets",
      title: "19. Tickets",
      blocks: [
        { p: "A ticket gives access under the organiser's conditions and is checked by its code or QR pass at entry. Keep your ticket private: whoever presents a valid code may be admitted. Rules on transfer, refunds and changes are set by the organiser." },
      ],
    },
    {
      id: "bookings",
      title: "20. Bookings",
      blocks: [
        { p: "A booking is a request or agreement between the customer and the page owner. The owner confirms, changes or cancels it according to their own policies. Ringo only provides the booking tools." },
      ],
    },
    {
      id: "ambassadors",
      title: "21. Affiliate program and Ambassador program",
      blocks: [
        { p: "Ringo has two separate programs. In the **Affiliate program**, a participant shares a referral link and may earn commission on qualifying payments from the people they refer. In the **Ambassador program**, an Ambassador shares an Ambassador link or code and may earn commission on qualifying sales attributed to them." },
        { p: "Commission rates, holding periods and minimum payout amounts are those that apply to the program concerned at the time, are shown to participants where available, and may change. Commission is only earned on genuine referrals. We may withhold or reverse commission earned through fraud, abuse or self-referral, and may remove participants who break these Terms." },
      ],
    },
    {
      id: "smart-card",
      title: "22. Ringo Connect Smart Card",
      blocks: [
        { p: "A Ringo Connect Smart Card is a physical card that opens your Ringo page when tapped or scanned. It works with an active Ringo page, and the page it opens is yours to manage." },
      ],
    },
    {
      id: "whatsapp",
      title: "23. WhatsApp integrations",
      blocks: [
        { p: "Ringo can open WhatsApp conversations and, if you connect a WhatsApp Business number, show and send messages in Ringo's inbox. You must follow WhatsApp's and Meta's own terms and policies, have the right to message the people you contact, and respect their choices. You are responsible for the messages you send, including automated ones." },
      ],
    },
    {
      id: "ai",
      title: "24. AI features",
      blocks: [
        { p: "Ringo AI can draft content and answer questions about your workspace. It can be wrong or incomplete, so check its output before you rely on it or publish it. It is not professional advice. You are responsible for what you do with it. We may limit its use, and may change or remove it." },
      ],
    },
    {
      id: "prohibited",
      title: "25. Prohibited activity",
      blocks: [
        { p: "You may not use Ringo to:" },
        {
          ul: [
            "sell or promote illegal goods or services;",
            "commit fraud, mislead people or impersonate another person or business;",
            "infringe intellectual property rights or upload content you have no right to use;",
            "harass, threaten or abuse anyone, or publish unlawful or harmful content;",
            "send spam or unsolicited messages, including through Ringo's messaging and notification tools;",
            "collect or use other people's personal information unlawfully;",
            "interfere with, probe or try to gain unauthorized access to Ringo's systems or other users' accounts;",
            "abuse commissions, referrals, payments or protections.",
          ],
        },
      ],
    },
    {
      id: "intellectual-property",
      title: "26. Intellectual property",
      blocks: [
        { p: "The Ringo and Ringo Connect names, logos and software belong to Ringo Connect Ltd. These Terms give you no right to use them except to use the service as intended." },
      ],
    },
    {
      id: "suspension-termination",
      title: "27. Suspension and termination",
      blocks: [
        { p: "You can stop using Ringo at any time and ask us to close your account by writing to info@ringoconnectltd.com. We may suspend or end an account, or hide a page, for breaking these Terms or the law, for non-payment, for security reasons, or where required by law. While an account is suspended its public page may be unavailable. We may keep certain information as described in the Privacy Policy." },
      ],
    },
    {
      id: "availability",
      title: "28. Availability of the platform",
      blocks: [
        { p: "Ringo is provided “as is” and “as available”. We work to keep it running but do not promise it will always be available, uninterrupted or error-free, and we may change, pause or discontinue features." },
      ],
    },
    {
      id: "third-party-services",
      title: "29. Third-party services",
      blocks: [
        { p: "Ringo relies on third-party providers such as Supabase, Vercel, Fapshi, Stripe, Resend, Meta, Google, Apple, Anthropic and OpenAI. Their availability and terms are outside our control, and an outage or change on their side can affect Ringo." },
      ],
    },
    {
      id: "liability",
      title: "30. Limitation of liability",
      blocks: [
        { p: "To the extent the law allows, Ringo Connect Ltd. is not liable for indirect, incidental or consequential losses arising from your use of Ringo, or for disputes between a page owner and their customers, visitors or team. You agree to indemnify Ringo Connect Ltd. against claims arising from your content, your use of Ringo or your breach of these Terms." },
      ],
    },
    {
      id: "governing-law",
      title: "31. Disputes and governing law",
      blocks: [
        { p: "These Terms are governed by the laws of the Republic of Cameroon, and disputes are subject to the exclusive jurisdiction of the courts of Yaoundé, Cameroon." },
      ],
    },
    {
      id: "changes",
      title: "32. Changes to these Terms",
      blocks: [
        { p: "We may update these Terms as Ringo changes. The date at the top shows when they were last updated. Continuing to use Ringo after an update means you accept the new Terms; we will give reasonable notice of material changes where practical. If any part of these Terms is found unenforceable, the rest still applies." },
      ],
    },
    {
      id: "contact",
      title: "33. Contact",
      blocks: [
        { p: "Questions about these Terms: info@ringoconnectltd.com. Ringo Connect Ltd., Yaoundé, Cameroon." },
      ],
    },
  ],
};
