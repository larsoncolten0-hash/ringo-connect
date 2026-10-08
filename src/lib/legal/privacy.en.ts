import type { LegalDoc } from "./types";

// Written from what the Ringo Connect product actually does today. It does not claim certifications or compliance statuses, and where a legal or business fact cannot be established from the
// product itself it says so in plain, conservative words instead of inventing an answer (no fixed retention periods, safeguards, minimum age or rights are stated beyond what the code does).
export const privacyEn: LegalDoc = {
  title: "Privacy Policy",
  description: "How Ringo Connect collects, uses and protects personal information: accounts, public pages, payments, notifications, cookies and more.",
  updated: "October 8, 2026",
  intro: [
    "This Privacy Policy explains how Ringo Connect handles personal information. Ringo Connect is operated by Ringo Connect Ltd. (Yaoundé, Cameroon) (“Ringo”, “we”, “us”). It describes what the product does today and will be updated as the product changes.",
    "Ringo is used by page owners (creators, artists, businesses) and by their visitors and customers. When a page owner collects information from their own customers through their Ringo page, the page owner decides why it is collected; Ringo provides the platform they use.",
  ],
  sections: [
    {
      id: "who-we-are",
      title: "1. Who we are",
      blocks: [
        { p: "Ringo Connect is operated by Ringo Connect Ltd., Yaoundé, Cameroon. You can reach us at info@ringoconnectltd.com." },
      ],
    },
    {
      id: "information-you-provide",
      title: "2. Information you provide",
      blocks: [
        { p: "**Account.** Your email address and password when you create an account, or your name and email if you sign in with Google or Apple. Your password is handled by our authentication provider and is not stored by Ringo in readable form." },
        { p: "**Your page.** Whatever you add to your Ringo page: name, bio, photos, links, social links, phone and WhatsApp numbers, location and opening hours, products and prices, menu items, music, events and similar content." },
        { p: "**Messages to us.** What you send us when you contact us or ask for help." },
      ],
    },
    {
      id: "information-collected-automatically",
      title: "3. Information collected automatically",
      blocks: [
        { p: "**Visits to public pages.** When someone opens a Ringo page or taps a link, product or WhatsApp button on it, we record that event together with the page, the time, the referring site and an approximate country and city derived from the request. This is how page owners see their statistics." },
        { p: "**Technical data.** Like any web service, we process IP addresses and browser details to deliver pages, prevent abuse and keep the service secure." },
        { p: "**Signed-in activity.** For account holders we record when an account was last active and whether the installed (home-screen) app is being used, to understand and support usage of the product." },
      ],
    },
    {
      id: "public-profile-information",
      title: "4. Public profile information",
      blocks: [
        { p: "A Ringo page is public by design. Anything you put on it can be seen by anyone with the link, a QR code or a Ringo Connect Smart Card, and may be found through search engines. Only publish information you are comfortable making public." },
      ],
    },
    {
      id: "uploaded-content",
      title: "5. Uploaded content",
      blocks: [
        { p: "Images, audio and files you upload are stored with our storage provider. Images used on public pages are served publicly. Files that are sold (for example full-length songs or digital products) are kept in private storage and are only delivered to people who have paid for them." },
      ],
    },
    {
      id: "contact-information",
      title: "6. Contact information of other people",
      blocks: [
        { p: "Depending on how a page is used, Ringo stores contact details of the people who interact with it: customers who place an order, make a booking or buy a ticket (name, phone, email where provided, order details); people who join a page's community or connect with a page (name, phone, email, notification preferences); and team members invited by an account owner (name, email, phone, role). This information belongs to the page it was given to and is not visible to other Ringo account holders." },
        { p: "Marketing communication is only sent to people who have opted in, and they can opt out at any time." },
      ],
    },
    {
      id: "account-authentication",
      title: "7. Account and authentication information",
      blocks: [
        { p: "We use sessions (stored in cookies) to keep you signed in, and send emails to confirm addresses, reset passwords and invite team members. Customers who sign in to their own Ringo customer space receive a separate session." },
      ],
    },
    {
      id: "payments",
      title: "8. Payment and transaction information",
      blocks: [
        { p: "We record orders and payments: what was bought, amounts, status, the payment provider's reference and, for Mobile Money, the phone number the payment request was sent to. We do not store full card numbers. We also keep the information needed to calculate and pay out balances to page owners and, where they apply, affiliate and ambassador commissions." },
      ],
    },
    {
      id: "fapshi-stripe",
      title: "9. Fapshi and Stripe",
      blocks: [
        { p: "Mobile Money payments and payouts are processed by Fapshi. Card payments are processed by Stripe. When you pay, the details needed for the payment are exchanged with the provider concerned, whose own privacy practices also apply." },
      ],
    },
    {
      id: "orders-commerce",
      title: "10. Orders and commerce",
      blocks: [
        { p: "When a customer buys from a page, the page owner receives the order details needed to fulfil it (customer name, contact details, items, delivery information where applicable). Ringo keeps order and stock records, and can send order confirmations and receipts by email." },
      ],
    },
    {
      id: "music-digital",
      title: "11. Music and digital products",
      blocks: [
        { p: "Listeners can hear a short preview of a song before buying. Purchases are recorded against the order so the buyer can access what they bought and receive a receipt. Artists who sell music provide payout details (for example a Mobile Money number) so earnings can be paid out." },
      ],
    },
    {
      id: "restaurant",
      title: "12. Restaurants and food orders",
      blocks: [
        { p: "Pages for restaurants can show a menu and accept orders. Orders contain the customer's name, phone number and what was ordered, and are shown to that restaurant's team. Order-status messages can be sent by email or notification." },
      ],
    },
    {
      id: "events-bookings",
      title: "13. Events, tickets and bookings",
      blocks: [
        { p: "Ticket purchases create tickets with a code and QR pass that can be scanned at the event. Bookings store the details the customer enters (such as name, contact details and the chosen service and time) so the page owner can confirm and manage them. Confirmations can be sent by email." },
      ],
    },
    {
      id: "ambassador",
      title: "14. Affiliate and ambassador programs",
      blocks: [
        { p: "If you follow a referral or ambassador link, the referral code is kept in your browser for up to 60 days so that it can be credited if you sign up. Participants in these programs provide payout details, and we record referrals, commissions and payouts." },
      ],
    },
    {
      id: "whatsapp",
      title: "15. WhatsApp",
      blocks: [
        { p: "WhatsApp buttons on a page open WhatsApp on your device; what you then write is handled by WhatsApp under its own terms and privacy policy. Where an account owner connects a WhatsApp Business number to Ringo's inbox, Ringo processes the messages and phone numbers of the people writing to that number, in order to show them to the owner and let the owner reply (including automated or AI-assisted replies if the owner turns them on)." },
      ],
    },
    {
      id: "smart-card-qr",
      title: "16. Ringo Connect Smart Card and QR codes",
      blocks: [
        { p: "A Ringo QR code or Ringo Connect Smart Card opens the owner's public page. Opening it is recorded like any other visit to the page (see section 3). Some programs, such as loyalty or memberships, use codes tied to a member's record in the same way as described in sections 6 and 10." },
      ],
    },
    {
      id: "push-notifications",
      title: "17. Push notifications",
      blocks: [
        { p: "If you choose to enable push notifications, we store the technical subscription details your browser or device gives us and use them to deliver notifications through your browser's push service. You can turn notifications off at any time in the app or in your browser settings." },
      ],
    },
    {
      id: "analytics",
      title: "18. Analytics and page views",
      blocks: [
        { p: "Page-view and click statistics are collected by Ringo itself and stored in our own database (see section 3); we do not use a third-party analytics service for them. Owners see these statistics for their own page." },
        { p: "Ringo lets page owners on eligible plans save a Meta (Facebook) or TikTok pixel in their settings. At present Ringo does not load these pixels on public pages and does not send events to Meta or TikTok for them. If this changes, this policy and the Cookie Policy will be updated first." },
      ],
    },
    {
      id: "ringo-ai",
      title: "19. Ringo AI",
      blocks: [
        { p: "Ringo AI is an assistant for account holders. What you type to it, any images you attach, and the limited information about your own Ringo workspace needed to answer (for example counts and settings) are sent to the AI provider Ringo has configured (currently Anthropic or OpenAI) to produce a response. Conversations are saved in your account. Please do not put sensitive personal information into Ringo AI." },
      ],
    },
    {
      id: "cookies",
      title: "20. Cookies and local storage",
      blocks: [
        { p: "Ringo uses cookies and similar browser storage to keep you signed in, remember your choices, credit referrals and make checkout work. The full list, with what each item is for and how long it lasts, is in our [Cookie Policy](/cookies)." },
        { p: "In short: sign-in and customer session cookies, a cookie for the organization a team member is working in and a short activity cookie are needed for the service; language, theme, sound, music-player and dismissed-prompt choices are kept on your device; and a referral or ambassador code is kept in your browser for up to 60 days." },
        { p: "Ringo does not currently set advertising or visitor-tracking identifiers and does not load Meta or TikTok pixels on public pages. When a public page is opened, Ringo removes any such identifier left by an earlier visit. Ringo does not currently show a cookie banner." },
      ],
    },
    {
      id: "third-parties",
      title: "21. Third-party services and processors",
      blocks: [
        { p: "We use these providers to run Ringo. They process data on our behalf, or, where stated, when you or a page owner choose to use them:" },
        {
          ul: [
            "Supabase: database, authentication and file storage.",
            "Vercel: application hosting.",
            "Fapshi: Mobile Money payments and payouts.",
            "Stripe: card payments for plans.",
            "Resend: email delivery (receipts, confirmations, invitations and announcements).",
            "Meta: WhatsApp Business messaging, if an owner connects it.",
            "Google and Apple: sign-in, if you choose to use them.",
            "Anthropic and OpenAI: Ringo AI.",
            "Browser push services (for example those run by Google, Apple and Mozilla): delivery of notifications you enabled.",
          ],
        },
        { p: "Each provider also has its own privacy practices. Which provider handles Ringo AI requests is a setting Ringo can change." },
      ],
    },
    {
      id: "how-we-use",
      title: "22. How we use information",
      blocks: [
        { p: "To run your account and page; to process orders, bookings, tickets, payments and payouts; to send receipts, confirmations and other messages about what you did on Ringo; to send marketing or community messages to people who opted in; to show page owners their statistics; to provide Ringo AI; to keep the service secure and prevent fraud and abuse; to support you; and to meet legal obligations." },
      ],
    },
    {
      id: "retention",
      title: "23. Data retention",
      blocks: [
        { p: "We keep personal information for as long as we need it to provide Ringo, and afterwards where we need it for legal, accounting, security and dispute-resolution purposes. Certain details of our data retention and legal obligations may depend on applicable law and our operational requirements, and we do not state fixed retention periods for orders, customer records, payment records, click statistics or logs here." },
        { p: "A few specific limits do apply: a referral or ambassador code is kept in your browser for up to 60 days; the reference of a signup payment in progress is kept in your browser for up to 3 hours; and demo accounts are deleted automatically after 7 days." },
      ],
    },
    {
      id: "security",
      title: "24. Data security",
      blocks: [
        { p: "We use access controls and database-level restrictions so account holders can only reach their own data, encrypt connections, and encrypt certain secrets (such as payment-provider credentials and marketing-API tokens) at rest. No online service is perfectly secure. If we become aware of a breach affecting your personal information we will notify those affected without undue delay where the law requires it." },
      ],
    },
    {
      id: "account-deletion",
      title: "25. Closing your account and deletion requests",
      blocks: [
        { p: "There is currently no self-service “delete my account” button. To ask us to close your account or to delete your information, write to info@ringoconnectltd.com. Requests are handled by our team and we cannot promise a particular timeline." },
        { p: "Closing an account does not necessarily mean everything is erased. We may need to keep some information, such as order, payment, payout and security records, where we need it for legal, accounting, security or dispute purposes." },
      ],
    },
    {
      id: "your-rights",
      title: "26. Your privacy choices",
      blocks: [
        { p: "You can ask us to access, correct or delete the personal information we hold about you, or raise a concern about how it is used, by writing to info@ringoconnectltd.com. We will consider your request in line with the law that applies. If you are a customer of a page owner, we may need to involve that page owner." },
      ],
    },
    {
      id: "international",
      title: "27. International processing",
      blocks: [
        { p: "Our providers may store or process information in countries other than the one where you live, including outside Cameroon, depending on the provider. Each provider's own terms and privacy practices apply to its processing." },
      ],
    },
    {
      id: "children",
      title: "28. Children",
      blocks: [
        { p: "Ringo is not directed at children. If we learn that we have collected personal information from a child in a way we should not have, we will take steps to remove it." },
      ],
    },
    {
      id: "changes",
      title: "29. Changes to this policy",
      blocks: [
        { p: "We may update this policy as the product or the law changes. The date at the top shows when it was last updated, and we will give reasonable notice of material changes where practical." },
      ],
    },
    {
      id: "contact",
      title: "30. Contact",
      blocks: [
        { p: "Questions about this policy, or requests about your information: info@ringoconnectltd.com. Ringo Connect Ltd., Yaoundé, Cameroon." },
      ],
    },
  ],
};
