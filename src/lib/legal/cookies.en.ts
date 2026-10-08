import type { LegalDoc } from "./types";

// What Ringo stores in a browser today, taken from the code (cookies, local storage and session storage). It makes no statement about whether consent is legally required for any of it.
export const cookiesEn: LegalDoc = {
  title: "Cookie Policy",
  description: "The cookies and browser storage Ringo Connect uses, what each is for and how long it lasts.",
  updated: "October 8, 2026",
  intro: [
    "This page lists the cookies and similar browser storage (local storage and session storage) that Ringo Connect uses today. It is part of our Privacy Policy and will be updated when the product changes.",
  ],
  sections: [
    {
      id: "essential",
      title: "1. Needed for the service to work",
      blocks: [
        { p: "These keep you signed in and let features such as checkout work. Without them parts of Ringo would not function." },
        {
          ul: [
            "**Sign-in session cookies** set by our authentication provider (Supabase) while an account holder is signed in.",
            "**Customer session cookie** (`ringo_customer`, or `__Host-ringo_customer` in production) for customers who sign in to their Ringo customer space. It lasts until that session expires.",
            "**Active organization cookie** (`ringo_active_org`) remembers which organization a team member is working in. It lasts up to 365 days.",
            "**Activity cookie** (`rc_active_ping`) is a short-lived cookie with no personal value that limits how often an account's activity is recorded. It lasts 5 minutes.",
            "**Signup payment reminder** (`rc_signup_pay`, local storage) holds the id of a signup payment in progress so it can be resumed after a reload. It is kept for up to 3 hours.",
          ],
        },
      ],
    },
    {
      id: "preferences",
      title: "2. Remembering your choices",
      blocks: [
        { p: "These store preferences on your device only." },
        {
          ul: [
            "Language (`ringo-lang`), theme (`ringo-theme`) and sound (`ringo-sound`).",
            "Music player preferences and theme (`ringo-player-prefs`, `ringo-player-theme`) and a small cache used by the music player (`ringo-peaks:v1:…`).",
            "Which prompts you dismissed, for example add-to-home-screen, notifications and dashboard guidance (`ringo-a2hs-dismissed-…`, `ringo-push-prompt-dismissed`, `ringo-push-resume`, `ringo-guidance-dismissed:…`).",
            "The step of the onboarding tour you reached (`ringo-onboarding-tour-step`, session storage, cleared when the tab closes).",
          ],
        },
      ],
    },
    {
      id: "referrals",
      title: "3. Referral and ambassador links",
      blocks: [
        { p: "If you arrive through an Affiliate program link (`rc_ref`) or an Ambassador program link (`rc_amb`), the code is kept in your browser's local storage for up to 60 days so that it can be credited if you sign up. These are two separate programs and two separate keys." },
      ],
    },
    {
      id: "measurement",
      title: "4. Statistics measured by Ringo",
      blocks: [
        { p: "Page-view and click statistics for a Ringo page are recorded by Ringo itself in its own database (the page, the time, the referring site and an approximate country and city). They do not use a cookie identifier. A browser-session marker (`ringo-session-pinged`, session storage) limits how often an installed-app session is reported for signed-in account holders." },
      ],
    },
    {
      id: "advertising",
      title: "5. Visitor identifiers and advertising pixels",
      blocks: [
        { p: "Ringo can let a page owner on an eligible plan save a Meta (Facebook) or TikTok pixel in their settings. **At present Ringo does not load these pixels on public pages, does not send events to Meta or TikTok for them, and does not set the visitor identifier (`ringo_vid`) or the TikTok click identifier (`ringo_ttclid`) that were used to match such events.**" },
        { p: "When a public Ringo page is opened, Ringo removes any of these cookies (`ringo_vid`, `ringo_ttclid`, `_fbp`, `_fbc`, `_ttp`) left in your browser by an earlier visit. If this changes in the future, this page and the Privacy Policy will be updated before it does." },
      ],
    },
    {
      id: "providers",
      title: "6. Other websites",
      blocks: [
        { p: "When you are sent to another provider, for example to pay, to sign in with Google or Apple, or to open WhatsApp, that provider's own cookie rules apply to its pages." },
      ],
    },
    {
      id: "control",
      title: "7. Managing cookies and storage",
      blocks: [
        { p: "You can delete cookies and site data in your browser settings or block them. If you do, you may be signed out and your saved preferences will be reset, and some features may stop working." },
      ],
    },
    {
      id: "contact",
      title: "8. Contact",
      blocks: [{ p: "Questions about this page: info@ringoconnectltd.com." }],
    },
  ],
};
