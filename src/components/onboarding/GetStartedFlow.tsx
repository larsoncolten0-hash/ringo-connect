"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Check, ArrowLeft, Loader2, X, User, Building2, Nfc } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { getReferralCode } from "@/lib/referral";
import LanguageToggle from "@/components/LanguageToggle";
import { formatPrice } from "@/lib/currency";
import { detectPlatform } from "@/lib/utils";
import ImageUploadField from "@/components/editor/ImageUploadField";
import PhoneCountryInput from "@/components/editor/PhoneCountryInput";
import SocialIcon from "@/components/SocialIcon";
import CategoryPicker from "@/components/CategoryPicker";
import { getCategory, type CategoryId } from "@/lib/categories";

type Step = "cardQuestion" | "bundlePicker" | "accountType" | "category" | "plan" | "info" | "payChoice" | "paying" | "success";
type AccountType = "personal" | "enterprise";
type LinkItem = { title: string; url: string };
type ProductItem = { name: string; price: string; image_url: string };
type SocialItem = { platform: string; url: string };
type PayStatus = "idle" | "sending" | "waiting" | "success" | "failed";

export default function GetStartedFlow({
  plans,
  addons,
  isCameroon,
  allowPayNow,
  manualPaymentName,
  manualPaymentMtnNumber,
  manualPaymentOrangeNumber,
  variant = "standard",
  preselectedPlan = null,
  initialIntent,
}: {
  plans: any[];
  addons: any[];
  isCameroon: boolean;
  allowPayNow: boolean;
  manualPaymentName: string;
  manualPaymentMtnNumber: string;
  manualPaymentOrangeNumber: string;
  // "affiliate" = /get-started-affiliate: payment is mandatory (no
  // "submit without paying" escape hatch, no pay-now/pay-later choice
  // screen — straight into payment), and a coupon/referral code field is
  // shown and editable rather than only captured silently in the
  // background. Everything else about the flow is identical.
  variant?: "standard" | "affiliate";
  // A specific plan row, resolved server-side from ?plan=<name> when
  // someone arrives here by tapping a plan on the landing page's #pricing
  // section (see get-started/page.tsx). Only meaningful on the standard
  // variant. Jumps straight to the "plan" step with this plan already
  // selected/highlighted — never skips that step's UI entirely, so they
  // can still change their mind (pick a different plan, or a different
  // track) before continuing, per the task this was built from.
  preselectedPlan?: any | null;
  // "sales_funnel": set from ?intent=sales_funnel (see get-started/
  // page.tsx) — the shareable "sales link" affiliates/creators generate
  // from their dashboard (see SalesFunnelLinkCard.tsx). Opens straight on
  // the cardQuestion step (a genuine "do you want a physical card?"
  // Yes/No question) instead of accountType, skipping the earlier steps
  // entirely. Renamed from the old "card_bundle" value, which forced a
  // two-choice screen rather than asking — see the entry-point
  // restructure this was built from.
  // "card_direct": set from ?card=1 (the landing page's #pricing "Ringo
  // Card" track, PricingSection.tsx) — skips straight to bundlePicker,
  // no question asked, same reasoning preselectedPlan skips straight to
  // "plan" instead of asking Personal/Business again.
  // Only meaningful on the standard variant, and only when no specific
  // plan already arrived preselected (that case already has a clearer,
  // more specific starting point).
  initialIntent?: "sales_funnel" | "card_direct";
}) {
  const { t, locale } = useLanguage();
  // Personal vs Enterprise — the very first choice on the standard flow
  // (see accountType step below), UNLESS a specific plan already arrived
  // pre-selected, in which case that plan's own track decides it and we
  // start straight on "plan" instead. The affiliate variant skips both of
  // these entirely and stays exactly as it always has: every non-free
  // plan offered at once, payment mandatory, no free path (accountType
  // just stays null there, and trackPlans below falls back to the full
  // list for that variant).
  const [step, setStep] = useState<Step>(() => {
    if (variant !== "standard") return "category";
    if (preselectedPlan) return "plan";
    if (initialIntent === "sales_funnel") return "cardQuestion";
    if (initialIntent === "card_direct") return "bundlePicker";
    return "accountType";
  });
  const [accountType, setAccountType] = useState<AccountType | null>(() =>
    preselectedPlan ? (preselectedPlan.team_enabled ? "enterprise" : "personal") : null
  );
  const [selectedPlan, setSelectedPlan] = useState<any | null>(preselectedPlan);
  const [category, setCategory] = useState<CategoryId | null>(null);
  const [extraCategories, setExtraCategories] = useState<CategoryId[]>([]);
  const [billingInterval, setBillingInterval] = useState<"monthly" | "yearly">("monthly");
  const [selectedAddonIds, setSelectedAddonIds] = useState<string[]>(() =>
    addons.filter((a) => a.required).map((a) => a.id)
  );

  const [fullName, setFullName] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [note, setNote] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [referralPrefilled, setReferralPrefilled] = useState(false);

  // Same capture mechanism as everywhere else (see src/lib/referral.ts) —
  // prefills from ?ref=CODE if that's how this person got here, but stays
  // a normal editable field either way. On the standard flow this just
  // reproduces what used to happen silently at submit time; on the
  // affiliate flow it's actually shown on screen (see the coupon code
  // field in the info step below).
  useEffect(() => {
    const stored = getReferralCode();
    if (stored) {
      setReferralCode(stored);
      setReferralPrefilled(true);
    }
  }, []);

  const [links, setLinks] = useState<LinkItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [socials, setSocials] = useState<SocialItem[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Set once the request row is actually created — happens either on
  // final submit (pay-later path) or the moment "Pay now" is chosen (so
  // the payment can reference a real row). Retrying a failed payment
  // reuses this id rather than creating a duplicate request.
  const [createdRequestId, setCreatedRequestId] = useState<string | null>(null);
  const [payPhone, setPayPhone] = useState("");
  const [payMedium, setPayMedium] = useState<"mobile money" | "orange money">("mobile money");
  const [payStatus, setPayStatus] = useState<PayStatus>("idle");
  const [payError, setPayError] = useState("");
  // True only once a Fapshi payment actually confirms — decides whether
  // the success screen thanks them for paying, or tells them how to pay
  // manually (they either never chose to pay now, or gave up and hit
  // "continue without paying").
  const [paidOnline, setPaidOnline] = useState(false);

  const [pathPrefix] = useState(() => `signup-requests/${crypto.randomUUID()}`);

  // Guards createRequest against being entered twice concurrently. A ref
  // (not state) because it must take effect the instant it's set —
  // state updates are batched/async, so two fast clicks on the submit
  // button can both fire before a `submitting` state re-render lands,
  // each creating its own signup_requests row.
  const requestInFlight = useRef(false);

  const catalogAllowed = selectedPlan ? Number(selectedPlan.max_products) !== 0 : false;
  const maxLinks: number | null = selectedPlan?.max_links ?? null;
  const maxProducts: number | null = selectedPlan?.max_products ?? null;

  // The plans actually offered on the "plan" step — filtered to whichever
  // track was chosen (Personal = !team_enabled, Business = team_enabled;
  // Business has no free tier at all, confirmed by the pricing migration,
  // so this filter alone is what keeps Free out of the Business list — no
  // separate "is this the free plan" check needed). The affiliate variant
  // never filters at all: every non-free plan is offered together, exactly
  // as it always has been.
  const trackPlans = variant === "standard" ? plans.filter((p) => Boolean(p.team_enabled) === (accountType === "enterprise")) : plans;

  const selectPlan = (plan: any) => {
    setSelectedPlan(plan);
    // Standard: plan -> category (the new order this task introduces).
    // Affiliate: category already happened before plan, same as always —
    // straight on to info.
    setStep(variant === "standard" ? "category" : "info");
  };

  // The two Ringo Card bundle rows — active addons that grant a plan (see
  // 2026-10-07_card_subscription_bundles.sql). Reuses the same `addons`
  // list the info step's own addon checkboxes draw from, rather than a
  // separate fetch — but excluded from that checklist itself below (see
  // checklistAddons): "Ringo Card" is now its own top-level entry point,
  // not one more independently-checkable box among unrelated addons
  // (which is also what let both bundles be picked at once before this
  // restructure — no longer possible now that this is the only way in).
  const bundleAddons = addons.filter((a) => a.grants_plan_duration_days);
  // Scoped to the standard variant only, per the task's own wording
  // ("the generic addon checklist shown during normal Personal/Business
  // signup") — the affiliate variant (/get-started-affiliate) curates its
  // own addon list independently (show_on_affiliate_page) and never
  // visits accountType/cardQuestion/bundlePicker at all, so filtering
  // bundles out of ITS checklist too would remove the only way an
  // affiliate-page visitor could buy one, with no replacement entry point
  // offered there. Flagged in the summary rather than decided here.
  const checklistAddons = variant === "standard" ? addons.filter((a) => !a.grants_plan_duration_days) : addons;

  // A1 (organic entry): the third top-level choice on the accountType
  // step below, alongside Personal/Business — a bundle grants Basic
  // directly, so this skips the "plan" step entirely, same as it already
  // did before this restructure.
  const chooseCardBundle = () => setStep("bundlePicker");

  // Task B (sales-funnel link only): the very first thing asked there —
  // "Do you want a Ringo physical card?" Yes routes to the exact same
  // bundlePicker destination as chooseCardBundle above; No drops into the
  // normal accountType step exactly as if this were a plain organic
  // visit (still shows all three choices there, Ringo Card included —
  // nothing is hidden or forced for a "No" answer).
  const answerCardQuestion = (wantsCard: boolean) => {
    if (!wantsCard) {
      // Covers cardQuestion -> Yes -> bundlePicker -> pick a bundle ->
      // back -> back -> No — a real, reachable path where a bundle was
      // already added to selectedAddonIds before backing all the way out
      // to answer "No" instead. Same reset chooseAccountType does.
      setSelectedAddonIds((prev) => prev.filter((id) => addons.find((a) => a.id === id)?.required));
    }
    setStep(wantsCard ? "bundlePicker" : "accountType");
  };

  // Selecting a bundle behaves like picking an addon, not a plan — the
  // bundle grants its plan through the same addon-approval path
  // /api/admin/requests/[id]/approve already handles, not through
  // selectedPlan/the "plan" step. Keeps any already-selected required
  // addon, replaces any previously chosen bundle (only one makes sense at
  // a time — there is no other entry point left that could select a
  // second one), then continues into category -> info like the rest of
  // the standard flow.
  const chooseBundle = (addon: any) => {
    setSelectedAddonIds((prev) => [...prev.filter((id) => addons.find((a) => a.id === id)?.required), addon.id]);
    setStep("category");
  };

  // Whether the currently selected addons include one of the two
  // bundles — used to send the category step's back button to
  // "bundlePicker" instead of "plan" (a bundle purchase never visits the
  // "plan" step at all, so there's nothing there to go back to).
  const hasBundleSelected = selectedAddonIds.some((id) => bundleAddons.some((b) => b.id === id));

  // Resets any previously selected plan — Personal and Business now both
  // require an explicit plan pick on the very next step ("plan"), so there
  // is nothing sensible to auto-select here (unlike before this task, when
  // Enterprise had exactly one plan to auto-select and Personal had none
  // to pick from at all).
  const chooseAccountType = (type: AccountType) => {
    setAccountType(type);
    setSelectedPlan(null);
    // Clears any bundle picked via the "Ringo Card" choice before backing
    // out to here (accountType -> bundlePicker -> pick -> back -> back ->
    // Personal/Business is a real, reachable path) — choosing Personal or
    // Business is a genuine change of track, not a deeper step inside the
    // Ringo Card flow, so nothing bundle-related should silently carry
    // into a plan-based signup. Required addons are kept, same as
    // chooseBundle's own reset.
    setSelectedAddonIds((prev) => prev.filter((id) => addons.find((a) => a.id === id)?.required));
    setStep("plan");
  };

  // Where "category" continues to — standard already resolved a plan
  // before ever reaching category (accountType -> plan -> category), so
  // it goes straight to "info". Affiliate keeps its own original order
  // (category -> plan -> info) untouched — this task only restructures
  // the standard flow.
  const afterCategoryStep: Step = variant === "standard" ? "info" : "plan";

  const addLink = () => setLinks((prev) => [...prev, { title: "", url: "" }]);
  const updateLink = (i: number, patch: Partial<LinkItem>) =>
    setLinks((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  const removeLink = (i: number) => setLinks((prev) => prev.filter((_, idx) => idx !== i));

  const addProduct = () => setProducts((prev) => [...prev, { name: "", price: "", image_url: "" }]);
  const updateProduct = (i: number, patch: Partial<ProductItem>) =>
    setProducts((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const removeProduct = (i: number) => setProducts((prev) => prev.filter((_, idx) => idx !== i));

  const addSocial = () => setSocials((prev) => [...prev, { platform: "link", url: "" }]);
  const updateSocialUrl = (i: number, url: string) =>
    setSocials((prev) => prev.map((s, idx) => (idx === i ? { platform: detectPlatform(url), url } : s)));
  const removeSocial = (i: number) => setSocials((prev) => prev.filter((_, idx) => idx !== i));

  const toggleAddon = (addon: any) => {
    if (addon.required) return; // can't be unchecked
    setSelectedAddonIds((prev) => {
      if (prev.includes(addon.id)) return prev.filter((id) => id !== addon.id);
      // Mutual exclusion between the two Ringo Card bundles — the same
      // underlying "both bundles stackable" bug A2 fixed on the standard
      // variant by removing them from this checklist entirely. The
      // affiliate variant (/get-started-affiliate) keeps its own,
      // independently-curated checklist (show_on_affiliate_page) and
      // never visits accountType/cardQuestion at all, so a top-level
      // "Ringo Card" entry point doesn't fit its deliberately simpler
      // "every option in one list, payment mandatory" design — this
      // constraint is the equivalent fix for that page specifically.
      // No-op wherever bundles never reach this checklist in the first
      // place (the standard variant, via checklistAddons).
      const withoutOtherBundles = addon.grants_plan_duration_days
        ? prev.filter((id) => !bundleAddons.some((b) => b.id === id))
        : prev;
      return [...withoutOtherBundles, addon.id];
    });
  };

  const getPrice = (item: any) => (isCameroon ? Number(item.price_xaf) : Number(item.price_usd));

  const planPrice = selectedPlan
    ? isCameroon
      ? billingInterval === "yearly"
        ? Number(selectedPlan.price_xaf_yearly)
        : Number(selectedPlan.price_xaf)
      : billingInterval === "yearly"
      ? Number(selectedPlan.price_usd_yearly)
      : Number(selectedPlan.price_usd)
    : 0;

  const selectedAddons = addons.filter((a) => selectedAddonIds.includes(a.id));
  const addonsTotal = selectedAddons.reduce((sum, a) => sum + getPrice(a), 0);
  const grandTotal = planPrice + addonsTotal;

  // Whether payment collection applies below — the actual TOTAL due
  // (plan + every selected addon), not just the plan's own price. Fixed
  // as part of this task: a Card + Subscription bundle is a priced addon
  // on an otherwise-free ("no plan selected") signup, so gating only on
  // the plan's price would have let someone through with neither the
  // bundle nor any other priced addon actually charged for.
  const isFreeSelection = grandTotal <= 0;

  // Returns the created request's id, or null on failure (error state
  // already set). Used by both the pay-later path (direct submit) and
  // the pay-now path (creates the row right before initiating payment).
  // `pendingOnlinePayment` tells the backend which case this is — see
  // /api/signup-requests' own comment on why that decides whether an
  // admin is notified immediately or only once the payment (started
  // right after this call returns, in sendPayment()) actually succeeds.
  const createRequest = async (pendingOnlinePayment = false): Promise<string | null> => {
    setError("");
    if (!fullName.trim() || !whatsapp.trim()) {
      setError(t.getStarted.requiredError);
      return null;
    }
    const res = await fetch("/api/signup-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        full_name: fullName.trim(),
        whatsapp_number: whatsapp.trim(),
        email: email.trim() || null,
        category: category || null,
        categories: category ? [category, ...extraCategories] : [],
        referral_code: referralCode.trim() || null,
        source: variant === "affiliate" ? "affiliate" : "get_started",
        suggested_username: username.trim() || null,
        avatar_url: avatarUrl || null,
        business_note: note.trim() || null,
        delivery_location: deliveryLocation.trim() || null,
        requested_plan_id: selectedPlan?.id || null,
        requested_interval: billingInterval,
        requested_links: links.filter((l) => l.title.trim() && l.url.trim()),
        requested_products: catalogAllowed
          ? products.filter((p) => p.name.trim()).map((p) => ({ ...p, price: p.price ? Number(p.price) : null }))
          : [],
        requested_social_links: socials.filter((s) => s.url.trim()),
        requested_addon_ids: selectedAddonIds,
        pending_online_payment: pendingOnlinePayment,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      // Show whatever the backend actually said went wrong, not just a
      // generic "try again" — that's the only way to tell a validation
      // problem apart from a real server/DB failure.
      setError(data.error || t.getStarted.submitError);
      return null;
    }
    return data.id;
  };

  const submitWithoutPaying = async () => {
    if (requestInFlight.current) return; // already submitting — ignore the repeat click
    requestInFlight.current = true;
    setSubmitting(true);
    try {
      const id = await createRequest();
      if (id) setStep("success");
    } finally {
      requestInFlight.current = false;
      setSubmitting(false);
    }
  };

  const handleInfoContinue = () => {
    if (isFreeSelection) {
      // No plan/payment step regardless of allowPayNow — straight to
      // submission (same request pipeline every other path uses).
      // Personal's Free plan is the common case, but this is keyed off
      // the plan's actual price, not the track — Business has no free
      // tier to reach this branch through at all.
      submitWithoutPaying();
    } else if (variant === "affiliate") {
      setError("");
      if (!fullName.trim() || !whatsapp.trim()) {
        setError(t.getStarted.requiredError);
        return;
      }
      // Payment is mandatory here — there's no pay-later choice screen to
      // show, straight into the payment step.
      setStep("paying");
    } else if (allowPayNow) {
      setError("");
      if (!fullName.trim() || !whatsapp.trim()) {
        setError(t.getStarted.requiredError);
        return;
      }
      setStep("payChoice");
    } else {
      submitWithoutPaying();
    }
  };

  const sendPayment = async () => {
    if (requestInFlight.current) return; // already submitting — ignore the repeat click
    requestInFlight.current = true;
    setPayError("");
    setPayStatus("sending");

    try {
      let requestId = createdRequestId;
      if (!requestId) {
        const created = await createRequest(true);
        if (!created) {
          setPayStatus("idle");
          return;
        }
        requestId = created;
        setCreatedRequestId(created);
      }

      // Everything past this point talks to Fapshi (directly, or indirectly
      // via our own route) — wrapped in try/catch so a network error, a
      // timeout, or a non-JSON error response surfaces as a real failure
      // state instead of leaving payStatus stuck on "sending" forever with
      // no feedback at all.
      const res = await fetch(`/api/signup-requests/${requestId}/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: payPhone, medium: payMedium }),
      });
      const data = await res.json();

      if (!res.ok) {
        setPayError(data.error || t.getStarted.payFailed);
        setPayStatus("failed");
        return;
      }

      setPayStatus("waiting");
      let attempts = 0;
      let consecutiveErrors = 0;
      const poll = setInterval(async () => {
        attempts++;
        try {
          const statusRes = await fetch(`/api/signup-requests/${requestId}/pay-status`);
          const statusData = await statusRes.json();

          // The route can 404/502 (bad transId, Fapshi unreachable, IP not
          // whitelisted, etc.) and still return valid JSON — that JSON just
          // won't have a `status` field. Previously this fell through to
          // the generic attempts>=40 timeout with no explanation, so a real
          // backend error looked identical to "still waiting" for up to two
          // minutes. Surface it immediately instead.
          if (!statusRes.ok) {
            consecutiveErrors++;
            if (consecutiveErrors >= 3) {
              clearInterval(poll);
              setPayStatus("failed");
              setPayError(statusData.error || t.getStarted.payFailed);
            }
            return;
          }
          consecutiveErrors = 0;

          if (statusData.status === "SUCCESSFUL") {
            clearInterval(poll);
            setPayStatus("success");
            setPaidOnline(true);
            setTimeout(() => setStep("success"), 700);
          } else if (statusData.status === "FAILED" || statusData.status === "EXPIRED") {
            clearInterval(poll);
            setPayStatus("failed");
            setPayError(statusData.reason || t.getStarted.payFailed);
          } else if (attempts >= 40) {
            clearInterval(poll);
            setPayStatus("failed");
            setPayError(t.getStarted.payFailed);
          }
        } catch (err: any) {
          // Transient network error (offline, DNS blip) — if it keeps
          // failing, treat it the same as a backend error above rather
          // than silently spinning until the 2-minute cutoff.
          consecutiveErrors++;
          if (consecutiveErrors >= 3) {
            clearInterval(poll);
            setPayStatus("failed");
            setPayError(err?.message || t.getStarted.payFailed);
          }
        }
      }, 3000);
    } catch (err: any) {
      setPayError(err.message || t.getStarted.payFailed);
      setPayStatus("failed");
    } finally {
      requestInFlight.current = false;
    }
  };

  return (
    <div className="min-h-screen bg-ringo-bg text-ringo-text flex flex-col items-center px-4 py-10">
      <div className="w-full max-w-md flex items-center justify-between mb-8">
        <Link href="/" className="flex items-center gap-2">
          <Image src="/logo.png" alt="" width={26} height={26} className="rounded-md" />
          <span className="font-display font-medium">Ringo Connect</span>
        </Link>
        <LanguageToggle />
      </div>

      <div className="w-full max-w-md">
        {/* Sales-funnel arrivals only (?intent=sales_funnel) — a genuine
            first question, not a hidden routing mechanism: framed exactly
            like every other choice screen in this flow, not as a
            disclaimer or a fine-print toggle. The organic flow never
            shows this at all; it offers "Ringo Card" as a plain third
            choice on the accountType step below instead. */}
        {step === "cardQuestion" && (
          <>
            <h1 className="font-display text-xl font-bold text-center mb-1">Do you want a Ringo physical card?</h1>
            <p className="text-sm text-ringo-muted text-center mb-6">A physical NFC card that opens your Ringo profile with a tap — optional either way.</p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => answerCardQuestion(true)}
                className="text-left rounded-card border border-ringo-border bg-ringo-surface p-5 transition hover:border-ringo-indigo active:scale-[0.98]"
              >
                <span className="block font-display text-base font-bold mb-1">Yes, I want a Ringo Card</span>
                <span className="block text-sm text-ringo-muted">See the two card + subscription bundle options.</span>
              </button>

              <button
                onClick={() => answerCardQuestion(false)}
                className="text-left rounded-card border border-ringo-border bg-ringo-surface p-5 transition hover:border-ringo-indigo active:scale-[0.98]"
              >
                <span className="block font-display text-base font-bold mb-1">No, just the platform</span>
                <span className="block text-sm text-ringo-muted">Continue to pick Personal or Business and a plan, no physical card.</span>
              </button>
            </div>
          </>
        )}

        {step === "bundlePicker" && (
          <>
            <button
              onClick={() => setStep(initialIntent === "sales_funnel" ? "cardQuestion" : "accountType")}
              className="flex items-center gap-1.5 text-sm text-ringo-muted mb-4"
            >
              <ArrowLeft size={15} />
              {t.getStarted.backButton}
            </button>

            <h1 className="font-display text-xl font-bold text-center mb-1">Choose your Ringo Card</h1>
            <p className="text-sm text-ringo-muted text-center mb-6">Never lowers an existing higher plan — only adds to it.</p>

            <div className="flex flex-col gap-3">
              {bundleAddons.map((bundle) => {
                // Admin-editable via /admin/addons (bundle_features) — a
                // sensible fallback covers a bundle row saved before that
                // field existed, or cleared blank by an admin.
                const features: string[] =
                  bundle.bundle_features && bundle.bundle_features.length > 0
                    ? bundle.bundle_features
                    : [`${bundle.grants_plan_duration_days >= 300 ? "1 year" : "1 month"} Basic subscription included`, "QR code on card", "Free card configuration"];

                return (
                  <button
                    key={bundle.id}
                    onClick={() => chooseBundle(bundle)}
                    className="text-left rounded-card border border-ringo-border bg-ringo-surface p-5 transition hover:border-ringo-indigo active:scale-[0.98]"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-display text-base font-bold">{bundle.name}</span>
                      <span className="text-base font-bold text-ringo-indigo" suppressHydrationWarning>
                        {formatPrice(getPrice(bundle), isCameroon ? "XAF" : "USD", locale)}
                      </span>
                    </div>
                    <ul className="flex flex-col gap-1">
                      {features.map((f) => (
                        <li key={f} className="flex items-start gap-1.5 text-sm text-ringo-muted">
                          <Check size={14} className="text-ringo-teal shrink-0 mt-0.5" />
                          {f}
                        </li>
                      ))}
                    </ul>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "accountType" && (
          <>
            {initialIntent === "sales_funnel" && (
              <button onClick={() => setStep("cardQuestion")} className="flex items-center gap-1.5 text-sm text-ringo-muted mb-4">
                <ArrowLeft size={15} />
                {t.getStarted.backButton}
              </button>
            )}
            <h1 className="font-display text-xl font-bold text-center mb-1">{t.getStarted.accountTypeTitle}</h1>
            <p className="text-sm text-ringo-muted text-center mb-6">{t.getStarted.accountTypeSubtitle}</p>

            <div className="flex flex-col gap-3">
              <button
                onClick={() => chooseAccountType("personal")}
                className="text-left rounded-card border border-ringo-border bg-ringo-surface p-5 transition hover:border-ringo-indigo active:scale-[0.98] flex items-start gap-3.5"
              >
                <span className="w-10 h-10 rounded-full bg-ringo-indigo/10 flex items-center justify-center shrink-0">
                  <User size={18} className="text-ringo-indigo" />
                </span>
                <span>
                  <span className="block font-display text-base font-bold mb-1">{t.getStarted.accountTypePersonalLabel}</span>
                  <span className="block text-sm text-ringo-muted">{t.getStarted.accountTypePersonalDesc}</span>
                </span>
              </button>

              <button
                onClick={() => chooseAccountType("enterprise")}
                className="text-left rounded-card border border-ringo-border bg-ringo-surface p-5 transition hover:border-ringo-indigo active:scale-[0.98] flex items-start gap-3.5"
              >
                <span className="w-10 h-10 rounded-full bg-ringo-indigo/10 flex items-center justify-center shrink-0">
                  <Building2 size={18} className="text-ringo-indigo" />
                </span>
                <span>
                  <span className="block font-display text-base font-bold mb-1">{t.getStarted.accountTypeEnterpriseLabel}</span>
                  <span className="block text-sm text-ringo-muted">{t.getStarted.accountTypeEnterpriseDesc}</span>
                </span>
              </button>

              {/* A1: third top-level choice — a bundle grants Basic
                  directly, so this skips straight to bundlePicker rather
                  than going through chooseAccountType/the "plan" step
                  Personal and Business both use. Only shown when there's
                  actually something to sell here (bundleAddons empty
                  would mean no active Ringo Card bundle rows at all). */}
              {bundleAddons.length > 0 && (
                <button
                  onClick={chooseCardBundle}
                  className="text-left rounded-card border border-ringo-border bg-ringo-surface p-5 transition hover:border-ringo-indigo active:scale-[0.98] flex items-start gap-3.5"
                >
                  <span className="w-10 h-10 rounded-full bg-ringo-indigo/10 flex items-center justify-center shrink-0">
                    <Nfc size={18} className="text-ringo-indigo" />
                  </span>
                  <span>
                    <span className="block font-display text-base font-bold mb-1">{t.getStarted.accountTypeCardLabel}</span>
                    <span className="block text-sm text-ringo-muted">{t.getStarted.accountTypeCardDesc}</span>
                  </span>
                </button>
              )}
            </div>
          </>
        )}

        {step === "category" && (
          <>
            {variant === "standard" && (
              <button
                onClick={() => setStep(hasBundleSelected ? "bundlePicker" : "plan")}
                className="flex items-center gap-1.5 text-sm text-ringo-muted mb-4"
              >
                <ArrowLeft size={15} />
                {t.getStarted.backButton}
              </button>
            )}

            <h1 className="font-display text-xl font-bold text-center mb-1">{t.getStarted.categoryTitle}</h1>
            <p className="text-sm text-ringo-muted text-center mb-6">{t.getStarted.categorySubtitle}</p>

            <CategoryPicker
              locale={locale}
              primary={category}
              onSelectPrimary={setCategory}
              extra={extraCategories}
              onToggleExtra={(id) =>
                setExtraCategories((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]))
              }
              strings={{ morePrompt: t.getStarted.categoryMorePrompt, moreHint: t.getStarted.categoryMoreHint }}
            />

            <div className="flex flex-col gap-3 mt-6">
              <button
                onClick={() => setStep(afterCategoryStep)}
                disabled={!category}
                className="py-3 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-40"
              >
                {t.getStarted.continueButton}
              </button>
              <button
                onClick={() => setStep(afterCategoryStep)}
                className="text-sm text-ringo-muted hover:text-ringo-text transition-colors"
              >
                {t.getStarted.categorySkip}
              </button>
            </div>
          </>
        )}

        {step === "plan" && (
          <>
            <button
              onClick={() => setStep(variant === "standard" ? "accountType" : "category")}
              className="flex items-center gap-1.5 text-sm text-ringo-muted mb-4"
            >
              <ArrowLeft size={15} />
              {t.getStarted.backButton}
            </button>

            <h1 className="font-display text-xl font-bold text-center mb-1">{t.getStarted.pickPlanTitle}</h1>
            <p className="text-sm text-ringo-muted text-center mb-6">{t.getStarted.pickPlanSubtitle}</p>

            {trackPlans.some((p) => p.price_usd > 0) && (
              <div className="flex items-center justify-center gap-1 bg-ringo-muted/10 rounded-full p-1 mb-5 w-fit mx-auto">
                {(["monthly", "yearly"] as const).map((iv) => (
                  <button
                    key={iv}
                    onClick={() => setBillingInterval(iv)}
                    className={`text-xs font-medium px-4 py-1.5 rounded-full transition ${
                      billingInterval === iv ? "bg-ringo-surface text-ringo-indigo shadow-sm" : "text-ringo-muted"
                    }`}
                  >
                    {iv === "monthly" ? t.subscription.billingMonthly : t.subscription.billingYearly}
                  </button>
                ))}
              </div>
            )}

            <div className="flex flex-col gap-3">
              {trackPlans.map((plan) => {
                const features: string[] = (locale === "fr" ? plan.features_fr : plan.features_en) || [];
                const rawPrice = isCameroon
                  ? billingInterval === "yearly"
                    ? plan.price_xaf_yearly
                    : plan.price_xaf
                  : billingInterval === "yearly"
                  ? plan.price_usd_yearly
                  : plan.price_usd;
                const displayPrice = formatPrice(rawPrice, isCameroon ? "XAF" : "USD", locale);
                const isSelected = selectedPlan?.id === plan.id;

                return (
                  <button
                    key={plan.id}
                    onClick={() => selectPlan(plan)}
                    className={`text-left rounded-card border bg-ringo-surface p-5 transition hover:border-ringo-indigo active:scale-[0.98] ${
                      isSelected ? "border-ringo-indigo ring-2 ring-ringo-indigo/20" : "border-ringo-border"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-display text-lg font-bold">{plan.display_name || plan.name}</p>
                      <p className="text-lg font-bold text-ringo-indigo" suppressHydrationWarning>
                        {displayPrice}
                      </p>
                    </div>
                    {plan.max_team_seats != null && (
                      <p className="text-xs font-medium text-ringo-indigo mb-2">{t.getStarted.seatsCount(plan.max_team_seats)}</p>
                    )}
                    <ul className="flex flex-col gap-1 mb-4">
                      {features.slice(0, 3).map((f) => (
                        <li key={f} className="flex items-start gap-1.5 text-sm text-ringo-muted">
                          <Check size={14} className="text-ringo-teal shrink-0 mt-0.5" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <span
                      className={`block text-center text-sm font-medium py-2.5 rounded-card ${
                        isSelected ? "bg-ringo-indigo text-white" : "border border-ringo-border text-ringo-text"
                      }`}
                    >
                      {isSelected ? t.getStarted.selectedLabel : t.getStarted.selectButton}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "info" && (
          <>
            <button
              onClick={() => setStep(variant === "standard" ? "category" : "plan")}
              className="flex items-center gap-1.5 text-sm text-ringo-muted mb-4"
            >
              <ArrowLeft size={15} />
              {t.getStarted.backButton}
            </button>

            <h1 className="font-display text-xl font-bold mb-1">{t.getStarted.infoTitle}</h1>
            <p className="text-sm text-ringo-muted mb-6">{t.getStarted.infoSubtitle}</p>

            {error && <p className="text-sm text-red-500 bg-red-500/10 rounded-card px-3.5 py-2.5 mb-4">{error}</p>}

            <div className="flex flex-col gap-4">
              <div className="flex justify-center">
                <ImageUploadField value={avatarUrl} onChange={setAvatarUrl} pathPrefix={pathPrefix} shape="circle" size={88} />
              </div>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t.getStarted.nameLabel}</span>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={t.getStarted.namePlaceholder}
                  className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t.getStarted.whatsappLabel}</span>
                {/* WhatsApp links only work with the full number including
                    its country code (see WhatsAppButton.tsx's wa.me
                    link) — same country-code-dropdown + local-number split
                    the dashboard's own WhatsAppCard.tsx already uses, so a
                    number entered here is stored complete from the start
                    instead of needing to be fixed later in the editor. */}
                <PhoneCountryInput
                  value={whatsapp}
                  onChange={setWhatsapp}
                  placeholder={t.getStarted.whatsappPlaceholder}
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t.getStarted.emailLabel}</span>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t.getStarted.emailPlaceholder}
                  inputMode="email"
                  className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t.getStarted.usernameLabel}</span>
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                  placeholder={t.getStarted.usernamePlaceholder}
                  className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface"
                />
                <span className="text-xs text-ringo-muted">{t.getStarted.usernameHint}</span>
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t.getStarted.noteLabel}</span>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={getCategory(category)?.defaults.notePlaceholder[locale] || t.getStarted.notePlaceholder}
                  rows={3}
                  className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface resize-none"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">{t.getStarted.deliveryLocationLabel}</span>
                <input
                  value={deliveryLocation}
                  onChange={(e) => setDeliveryLocation(e.target.value)}
                  placeholder={t.getStarted.deliveryLocationPlaceholder}
                  className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface"
                />
              </label>

              <div className="border-t border-ringo-border pt-4 flex flex-col gap-3">
                <div>
                  <p className="text-sm font-medium">{t.getStarted.linksHeading}</p>
                  <p className="text-xs text-ringo-muted">{t.getStarted.linksHint}</p>
                </div>

                {links.map((link, i) => (
                  <div key={i} className="flex flex-col gap-2 rounded-card border border-ringo-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-ringo-muted">#{i + 1}</span>
                      <button onClick={() => removeLink(i)} className="text-ringo-muted hover:text-red-500">
                        <X size={14} />
                      </button>
                    </div>
                    <input
                      value={link.title}
                      onChange={(e) => updateLink(i, { title: e.target.value })}
                      placeholder={t.getStarted.linkTitlePlaceholder}
                      className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg"
                    />
                    <input
                      value={link.url}
                      onChange={(e) => updateLink(i, { url: e.target.value })}
                      placeholder={t.getStarted.linkUrlPlaceholder}
                      className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg"
                    />
                  </div>
                ))}

                {maxLinks === null || links.length < maxLinks ? (
                  <button onClick={addLink} className="text-sm font-medium text-ringo-indigo text-left">
                    {t.getStarted.addLink}
                  </button>
                ) : (
                  <p className="text-xs text-ringo-muted">{t.getStarted.limitReached(maxLinks!)}</p>
                )}
              </div>

              {catalogAllowed && (
                <div className="border-t border-ringo-border pt-4 flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-medium">{t.getStarted.catalogHeading}</p>
                    <p className="text-xs text-ringo-muted">{t.getStarted.catalogHint}</p>
                  </div>

                  {products.map((product, i) => (
                    <div key={i} className="flex flex-col gap-2 rounded-card border border-ringo-border p-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-ringo-muted">#{i + 1}</span>
                        <button onClick={() => removeProduct(i)} className="text-ringo-muted hover:text-red-500">
                          <X size={14} />
                        </button>
                      </div>
                      <div className="flex justify-center">
                        <ImageUploadField
                          value={product.image_url}
                          onChange={(url) => updateProduct(i, { image_url: url })}
                          pathPrefix={pathPrefix}
                          shape="square"
                          size={64}
                        />
                      </div>
                      <input
                        value={product.name}
                        onChange={(e) => updateProduct(i, { name: e.target.value })}
                        placeholder={t.getStarted.productNamePlaceholder}
                        className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg"
                      />
                      <input
                        value={product.price}
                        onChange={(e) => updateProduct(i, { price: e.target.value.replace(/[^0-9.]/g, "") })}
                        placeholder={t.getStarted.productPricePlaceholder}
                        inputMode="decimal"
                        className="border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg"
                      />
                    </div>
                  ))}

                  {maxProducts === null || products.length < maxProducts ? (
                    <button onClick={addProduct} className="text-sm font-medium text-ringo-indigo text-left">
                      {t.getStarted.addProduct}
                    </button>
                  ) : (
                    <p className="text-xs text-ringo-muted">{t.getStarted.limitReached(maxProducts!)}</p>
                  )}
                </div>
              )}

              <div className="border-t border-ringo-border pt-4 flex flex-col gap-3">
                <div>
                  <p className="text-sm font-medium">{t.getStarted.socialsHeading}</p>
                  <p className="text-xs text-ringo-muted">{t.getStarted.socialsHint}</p>
                </div>

                {socials.map((social, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="shrink-0">
                      <SocialIcon platform={social.platform} url={social.url || "#"} />
                    </span>
                    <input
                      value={social.url}
                      onChange={(e) => updateSocialUrl(i, e.target.value)}
                      placeholder={t.getStarted.socialUrlPlaceholder}
                      className="flex-1 border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg"
                    />
                    <button onClick={() => removeSocial(i)} className="text-ringo-muted hover:text-red-500 shrink-0">
                      <X size={16} />
                    </button>
                  </div>
                ))}

                <button onClick={addSocial} className="text-sm font-medium text-ringo-indigo text-left">
                  {t.getStarted.addSocial}
                </button>
              </div>

              {/* checklistAddons, not addons — the Ringo Card bundles are
                  excluded from this generic list (A2 of the entry-point
                  restructure): "Ringo Card" is now its own top-level
                  entry point (accountType step / cardQuestion step),
                  never an independently-checkable box here. This also
                  removes any way to select both bundles at once, or a
                  bundle alongside an unrelated free-plan signup. */}
              {checklistAddons.length > 0 && (
                <div className="border-t border-ringo-border pt-4 flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-medium">{t.getStarted.addonsHeading}</p>
                    <p className="text-xs text-ringo-muted">{t.getStarted.addonsHint}</p>
                  </div>

                  {checklistAddons.map((addon) => {
                    const checked = selectedAddonIds.includes(addon.id);
                    return (
                      <label
                        key={addon.id}
                        className={`flex items-center justify-between gap-3 rounded-card border p-3 ${
                          addon.required ? "opacity-80" : "cursor-pointer"
                        } ${checked ? "border-ringo-indigo bg-ringo-indigo/5" : "border-ringo-border"}`}
                      >
                        <span className="flex items-center gap-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={addon.required}
                            onChange={() => toggleAddon(addon)}
                            className="accent-ringo-indigo"
                          />
                          <span className="text-sm">
                            {addon.name}
                            {addon.required && (
                              <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ringo-indigo">
                                {t.getStarted.requiredTag}
                              </span>
                            )}
                          </span>
                        </span>
                        <span className="text-sm font-medium text-ringo-text shrink-0" suppressHydrationWarning>
                          {formatPrice(getPrice(addon), isCameroon ? "XAF" : "USD", locale)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {/* Shown on both variants now — previously only the
                  affiliate flow displayed this field, and the standard
                  flow just captured a stored ?ref= code silently in the
                  background. Now every signer can see and edit it. */}
              <div className="border-t border-ringo-border pt-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{t.getStarted.couponCodeLabel}</span>
                  <div className="relative">
                    <input
                      value={referralCode}
                      onChange={(e) => {
                        setReferralCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 40));
                        setReferralPrefilled(false);
                      }}
                      placeholder={t.getStarted.couponCodePlaceholder}
                      className={`w-full border rounded-card px-3.5 py-2.5 pr-9 text-sm bg-ringo-surface ${
                        referralPrefilled ? "border-ringo-teal" : "border-ringo-border"
                      }`}
                    />
                    {referralPrefilled && (
                      <Check size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-ringo-teal" />
                    )}
                  </div>
                </label>
                {referralPrefilled && <p className="mt-1 text-xs text-ringo-teal">{t.getStarted.couponCodeApplied}</p>}
              </div>

              {(selectedPlan || selectedAddons.length > 0) && (
                <div className="border-t border-ringo-border pt-4">
                  <p className="text-sm font-medium mb-2">{t.getStarted.totalHeading}</p>
                  <div className="rounded-card border border-ringo-border p-3.5 flex flex-col gap-1.5 text-sm">
                    {selectedPlan && (
                      <div className="flex justify-between">
                        <span className="text-ringo-muted">
                          {t.getStarted.totalPlan} ({selectedPlan.display_name || selectedPlan.name})
                        </span>
                        <span suppressHydrationWarning>{formatPrice(planPrice, isCameroon ? "XAF" : "USD", locale)}</span>
                      </div>
                    )}
                    {selectedAddons.map((a) => (
                      <div key={a.id} className="flex justify-between text-ringo-muted">
                        <span>
                          {t.getStarted.totalAddon}: {a.name}
                        </span>
                        <span suppressHydrationWarning>{formatPrice(getPrice(a), isCameroon ? "XAF" : "USD", locale)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between font-bold text-ringo-text pt-1.5 mt-1 border-t border-ringo-border">
                      <span>{t.getStarted.totalDue}</span>
                      <span suppressHydrationWarning>{formatPrice(grandTotal, isCameroon ? "XAF" : "USD", locale)}</span>
                    </div>
                  </div>
                </div>
              )}

              <button
                onClick={handleInfoContinue}
                disabled={submitting}
                className="flex items-center justify-center gap-2 py-3 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-60 mt-2"
              >
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {submitting
                  ? t.getStarted.submitting
                  : !isFreeSelection && (variant === "affiliate" || allowPayNow)
                  ? t.getStarted.continueButton
                  : t.getStarted.submitButton}
              </button>
            </div>
          </>
        )}

        {step === "payChoice" && (
          <>
            <button
              onClick={() => setStep("info")}
              className="flex items-center gap-1.5 text-sm text-ringo-muted mb-4"
            >
              <ArrowLeft size={15} />
              {t.getStarted.backButton}
            </button>

            <h1 className="font-display text-xl font-bold mb-4">{t.getStarted.payNowTitle}</h1>

            {(selectedPlan || selectedAddons.length > 0) && (
              <div className="rounded-card border border-ringo-border p-3.5 flex flex-col gap-1.5 text-sm mb-5">
                {selectedPlan && (
                  <div className="flex justify-between">
                    <span className="text-ringo-muted">
                      {t.getStarted.totalPlan} ({selectedPlan.display_name || selectedPlan.name})
                    </span>
                    <span suppressHydrationWarning>{formatPrice(planPrice, isCameroon ? "XAF" : "USD", locale)}</span>
                  </div>
                )}
                {selectedAddons.map((a) => (
                  <div key={a.id} className="flex justify-between text-ringo-muted">
                    <span>
                      {t.getStarted.totalAddon}: {a.name}
                    </span>
                    <span suppressHydrationWarning>{formatPrice(getPrice(a), isCameroon ? "XAF" : "USD", locale)}</span>
                  </div>
                ))}
                <div className="flex justify-between font-bold text-ringo-text pt-1.5 mt-1 border-t border-ringo-border">
                  <span>{t.getStarted.totalDue}</span>
                  <span suppressHydrationWarning>{formatPrice(grandTotal, isCameroon ? "XAF" : "USD", locale)}</span>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-500 bg-red-500/10 rounded-card px-3.5 py-2.5 mb-4">{error}</p>}

            <div className="flex flex-col gap-3">
              <button
                onClick={() => setStep("paying")}
                className="py-3 rounded-card bg-ringo-indigo text-white text-sm font-medium"
              >
                {t.getStarted.payChooseNow}
              </button>
            </div>
          </>
        )}

        {step === "paying" && (
          <>
            <button
              onClick={() => {
                // Affiliate mode never shows the payChoice screen — going
                // back from here has to return to "info", not to a step
                // that was never entered.
                setStep(variant === "affiliate" ? "info" : "payChoice");
                setPayStatus("idle");
                setPayError("");
              }}
              className="flex items-center gap-1.5 text-sm text-ringo-muted mb-4"
            >
              <ArrowLeft size={15} />
              {t.getStarted.backButton}
            </button>

            <h1 className="font-display text-xl font-bold mb-4">{t.getStarted.payChooseNow}</h1>

            {payStatus === "idle" && (
              <div className="flex flex-col gap-4">
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{t.getStarted.payPhoneLabel}</span>
                  <input
                    value={payPhone}
                    onChange={(e) => setPayPhone(e.target.value)}
                    placeholder={t.getStarted.whatsappPlaceholder}
                    inputMode="tel"
                    className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface"
                  />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{t.getStarted.payProviderLabel}</span>
                  <select
                    value={payMedium}
                    onChange={(e) => setPayMedium(e.target.value as any)}
                    className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface"
                  >
                    <option value="mobile money">MTN Mobile Money</option>
                    <option value="orange money">Orange Money</option>
                  </select>
                </label>
                <button
                  onClick={sendPayment}
                  disabled={!payPhone.trim()}
                  className="py-3 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-60"
                >
                  {t.getStarted.paySendButton}
                </button>
              </div>
            )}

            {(payStatus === "sending" || payStatus === "waiting") && (
              <div className="flex flex-col items-center text-center gap-3 py-10">
                <Loader2 size={28} className="animate-spin text-ringo-indigo" />
                <p className="text-sm text-ringo-muted max-w-xs">{t.getStarted.payWaiting}</p>
              </div>
            )}

            {payStatus === "success" && (
              <div className="flex flex-col items-center text-center gap-3 py-10">
                <span className="w-14 h-14 rounded-full bg-ringo-teal/10 flex items-center justify-center">
                  <Check size={24} className="text-ringo-teal" />
                </span>
                <p className="text-sm font-medium">{t.getStarted.paySuccess}</p>
              </div>
            )}

            {payStatus === "failed" && (
              <div className="flex flex-col items-center text-center gap-3 py-6">
                <p className="text-sm text-red-500">{payError || t.getStarted.payFailed}</p>
                <div className="flex flex-col gap-2 w-full">
                  <button
                    onClick={sendPayment}
                    className="py-2.5 rounded-card bg-ringo-indigo text-white text-sm font-medium"
                  >
                    {t.getStarted.payTryAgain}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center text-center gap-4 py-10">
            <span className="w-16 h-16 rounded-full bg-ringo-teal/10 flex items-center justify-center">
              <Check size={28} className="text-ringo-teal" />
            </span>
            <h1 className="font-display text-xl font-bold">{t.getStarted.successTitle}</h1>
            <p className={`text-sm text-ringo-muted ${paidOnline || isFreeSelection ? "max-w-xs" : "max-w-sm"}`}>
              {paidOnline || isFreeSelection
                ? t.getStarted.successBody
                : t.getStarted.successBodyManualPayment(manualPaymentMtnNumber, manualPaymentOrangeNumber, manualPaymentName)}
            </p>

            {/* Receipt: plan + any add-ons + total, so the customer walks
                away with a clear record of what they're being charged for,
                not just a "thanks" message. Most paths go through the
                "plan" step (standard: accountType -> plan; affiliate:
                category -> plan) so selectedPlan is set by here — the one
                exception is a Card + Subscription bundle bought via the
                cardOrPlatform/bundlePicker shortcut, which never visits
                "plan" at all (the bundle is an addon, not a plan pick), so
                this also has to show whenever there's a priced addon. */}
            {(selectedPlan || selectedAddons.length > 0) && (
              <div className="w-full rounded-card border border-ringo-border bg-ringo-surface p-4 text-left">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-medium">{t.getStarted.receiptHeading}</p>
                  <span
                    className={`text-[10px] font-medium uppercase tracking-wide px-2 py-1 rounded-full ${
                      paidOnline ? "bg-ringo-teal/10 text-ringo-teal" : "bg-ringo-muted/10 text-ringo-muted"
                    }`}
                  >
                    {paidOnline ? t.getStarted.receiptPaid : t.getStarted.receiptPending}
                  </span>
                </div>
                <div className="flex flex-col gap-1.5 text-sm">
                  {selectedPlan && (
                    <div className="flex justify-between">
                      <span className="text-ringo-muted">
                        {t.getStarted.totalPlan} ({selectedPlan.display_name || selectedPlan.name})
                      </span>
                      <span suppressHydrationWarning>{formatPrice(planPrice, isCameroon ? "XAF" : "USD", locale)}</span>
                    </div>
                  )}
                  {selectedAddons.map((a) => (
                    <div key={a.id} className="flex justify-between text-ringo-muted">
                      <span>
                        {t.getStarted.totalAddon}: {a.name}
                      </span>
                      <span suppressHydrationWarning>{formatPrice(getPrice(a), isCameroon ? "XAF" : "USD", locale)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between font-bold text-ringo-text pt-1.5 mt-1 border-t border-ringo-border">
                    <span>{t.getStarted.totalDue}</span>
                    <span suppressHydrationWarning>{formatPrice(grandTotal, isCameroon ? "XAF" : "USD", locale)}</span>
                  </div>
                </div>
              </div>
            )}

            <Link href="/" className="text-sm text-ringo-indigo font-medium mt-2">
              {t.getStarted.backHome}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}