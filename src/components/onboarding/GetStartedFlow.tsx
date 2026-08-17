"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Check, ArrowLeft, Loader2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import LanguageToggle from "@/components/LanguageToggle";
import { formatPrice } from "@/lib/currency";
import { detectPlatform } from "@/lib/utils";
import ImageUploadField from "@/components/editor/ImageUploadField";
import SocialIcon from "@/components/SocialIcon";

type Step = "plan" | "info" | "payChoice" | "paying" | "success";
type LinkItem = { title: string; url: string };
type ProductItem = { name: string; price: string; image_url: string };
type SocialItem = { platform: string; url: string };
type PayStatus = "idle" | "sending" | "waiting" | "success" | "failed";

export default function GetStartedFlow({
  plans,
  addons,
  isCameroon,
  allowPayNow,
}: {
  plans: any[];
  addons: any[];
  isCameroon: boolean;
  allowPayNow: boolean;
}) {
  const { t, locale } = useLanguage();
  // Only Business shows right now (filtered server-side), so there's
  // nothing to actually pick — auto-select it and start straight on the
  // info step. The picker UI below stays intact rather than being
  // ripped out, so re-enabling it later (if more plans come back) is
  // just reverting these two lines.
  const [step, setStep] = useState<Step>(plans.length === 1 ? "info" : "plan");
  const [selectedPlan, setSelectedPlan] = useState<any | null>(plans.length === 1 ? plans[0] : null);
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

  const [pathPrefix] = useState(() => `signup-requests/${crypto.randomUUID()}`);

  const catalogAllowed = selectedPlan ? Number(selectedPlan.max_products) !== 0 : false;
  const maxLinks: number | null = selectedPlan?.max_links ?? null;
  const maxProducts: number | null = selectedPlan?.max_products ?? null;

  const selectPlan = (plan: any) => {
    setSelectedPlan(plan);
    setStep("info");
  };

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
    setSelectedAddonIds((prev) =>
      prev.includes(addon.id) ? prev.filter((id) => id !== addon.id) : [...prev, addon.id]
    );
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

  // Returns the created request's id, or null on failure (error state
  // already set). Used by both the pay-later path (direct submit) and
  // the pay-now path (creates the row right before initiating payment).
  const createRequest = async (): Promise<string | null> => {
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
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(t.getStarted.submitError);
      return null;
    }
    return data.id;
  };

  const submitWithoutPaying = async () => {
    setSubmitting(true);
    const id = await createRequest();
    setSubmitting(false);
    if (id) setStep("success");
  };

  const handleInfoContinue = () => {
    if (allowPayNow) {
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
    setPayError("");
    setPayStatus("sending");

    let requestId = createdRequestId;
    if (!requestId) {
      const created = await createRequest();
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
    try {
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
      const poll = setInterval(async () => {
        attempts++;
        try {
          const statusRes = await fetch(`/api/signup-requests/${requestId}/pay-status`);
          const statusData = await statusRes.json();

          if (statusData.status === "SUCCESSFUL") {
            clearInterval(poll);
            setPayStatus("success");
            setTimeout(() => setStep("success"), 700);
          } else if (statusData.status === "FAILED" || statusData.status === "EXPIRED") {
            clearInterval(poll);
            setPayStatus("failed");
            setPayError(t.getStarted.payFailed);
          } else if (attempts >= 40) {
            clearInterval(poll);
            setPayStatus("failed");
            setPayError(t.getStarted.payFailed);
          }
        } catch {
          // Transient network error while polling — if it keeps failing,
          // the attempts>=40 cutoff above still ends the poll eventually.
        }
      }, 3000);
    } catch (err: any) {
      setPayError(err.message || t.getStarted.payFailed);
      setPayStatus("failed");
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
        {step === "plan" && (
          <>
            <h1 className="font-display text-xl font-bold text-center mb-1">{t.getStarted.pickPlanTitle}</h1>
            <p className="text-sm text-ringo-muted text-center mb-6">{t.getStarted.pickPlanSubtitle}</p>

            {plans.some((p) => p.price_usd > 0) && (
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
              {plans.map((plan) => {
                const features: string[] = (locale === "fr" ? plan.features_fr : plan.features_en) || [];
                const rawPrice = isCameroon
                  ? billingInterval === "yearly"
                    ? plan.price_xaf_yearly
                    : plan.price_xaf
                  : billingInterval === "yearly"
                  ? plan.price_usd_yearly
                  : plan.price_usd;
                const displayPrice = formatPrice(rawPrice, isCameroon ? "XAF" : "USD", locale);

                return (
                  <button
                    key={plan.id}
                    onClick={() => selectPlan(plan)}
                    className="text-left rounded-card border border-ringo-border bg-ringo-surface p-5 transition hover:border-ringo-indigo active:scale-[0.98]"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-display text-lg font-bold">{plan.display_name || plan.name}</p>
                      <p className="text-lg font-bold text-ringo-indigo" suppressHydrationWarning>
                        {displayPrice}
                      </p>
                    </div>
                    <ul className="flex flex-col gap-1 mb-4">
                      {features.slice(0, 3).map((f) => (
                        <li key={f} className="flex items-start gap-1.5 text-sm text-ringo-muted">
                          <Check size={14} className="text-ringo-teal shrink-0 mt-0.5" />
                          {f}
                        </li>
                      ))}
                    </ul>
                    <span className="block text-center text-sm font-medium py-2.5 rounded-card bg-ringo-indigo text-white">
                      {t.getStarted.selectButton}
                    </span>
                  </button>
                );
              })}
            </div>
          </>
        )}

        {step === "info" && (
          <>
            <button onClick={() => setStep("plan")} className="flex items-center gap-1.5 text-sm text-ringo-muted mb-4">
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
                <input
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder={t.getStarted.whatsappPlaceholder}
                  inputMode="tel"
                  className="border border-ringo-border rounded-card px-3.5 py-2.5 text-sm bg-ringo-surface"
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
                  placeholder={t.getStarted.notePlaceholder}
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

              {addons.length > 0 && (
                <div className="border-t border-ringo-border pt-4 flex flex-col gap-3">
                  <div>
                    <p className="text-sm font-medium">{t.getStarted.addonsHeading}</p>
                    <p className="text-xs text-ringo-muted">{t.getStarted.addonsHint}</p>
                  </div>

                  {addons.map((addon) => {
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

              {selectedPlan && (
                <div className="border-t border-ringo-border pt-4">
                  <p className="text-sm font-medium mb-2">{t.getStarted.totalHeading}</p>
                  <div className="rounded-card border border-ringo-border p-3.5 flex flex-col gap-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-ringo-muted">
                        {t.getStarted.totalPlan} ({selectedPlan.display_name || selectedPlan.name})
                      </span>
                      <span suppressHydrationWarning>{formatPrice(planPrice, isCameroon ? "XAF" : "USD", locale)}</span>
                    </div>
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
                {submitting ? t.getStarted.submitting : allowPayNow ? t.getStarted.continueButton : t.getStarted.submitButton}
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

            {selectedPlan && (
              <div className="rounded-card border border-ringo-border p-3.5 flex flex-col gap-1.5 text-sm mb-5">
                <div className="flex justify-between">
                  <span className="text-ringo-muted">
                    {t.getStarted.totalPlan} ({selectedPlan.display_name || selectedPlan.name})
                  </span>
                  <span suppressHydrationWarning>{formatPrice(planPrice, isCameroon ? "XAF" : "USD", locale)}</span>
                </div>
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
              <button
                onClick={submitWithoutPaying}
                disabled={submitting}
                className="flex items-center justify-center gap-2 py-3 rounded-card border border-ringo-border text-ringo-text text-sm font-medium disabled:opacity-60"
              >
                {submitting && <Loader2 size={15} className="animate-spin" />}
                {submitting ? t.getStarted.submitting : t.getStarted.payChooseLater}
              </button>
            </div>
          </>
        )}

        {step === "paying" && (
          <>
            <button
              onClick={() => {
                setStep("payChoice");
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
                  <button
                    onClick={() => setStep("success")}
                    className="py-2.5 rounded-card border border-ringo-border text-ringo-text text-sm font-medium"
                  >
                    {t.getStarted.payContinueWithoutPaying}
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
            <p className="text-sm text-ringo-muted max-w-xs">{t.getStarted.successBody}</p>
            <Link href="/" className="text-sm text-ringo-indigo font-medium mt-2">
              {t.getStarted.backHome}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}