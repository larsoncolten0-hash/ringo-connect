"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Plus, Minus, ShoppingCart, X, Check, Loader2 } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { getRestaurantSubcategory } from "@/lib/categories";
import { isOpenNow } from "@/lib/restaurantHours";
import ImageGallery from "@/components/ImageGallery";

type CartLine = { menuItemId: string; name: string; price: number; quantity: number; notes: string };
type OrderType = "dine_in" | "takeaway" | "delivery";
type Step = "menu" | "checkout" | "confirmation";

// The actual ordering surface — reached from the public profile's "View
// Menu"/"Order Now" buttons or a table's QR code. No account required
// (guest ordering); everything the server actually trusts is re-derived
// from menu_items in /api/orders, never taken from this component's own
// state — see that route's comments.
export default function RestaurantOrderPage({ profile, table }: { profile: any; table: { id: string; label: string } | null }) {
  const { t, locale } = useLanguage();
  const accent = profile.theme_color || "#1F9D55";
  const currency = profile.currency || "USD";

  const categories: any[] = (profile.menu_categories || []).sort((a: any, b: any) => a.sort_order - b.sort_order);
  const items: any[] = profile.menu_items || [];
  const itemsByCategory = (categoryId: string) =>
    items.filter((i) => i.menu_category_id === categoryId).sort((a, b) => a.sort_order - b.sort_order);
  const uncategorized = items.filter((i) => !i.menu_category_id);

  const [step, setStep] = useState<Step>("menu");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [showCart, setShowCart] = useState(false);

  const [orderType, setOrderType] = useState<OrderType>(
    table ? "dine_in" : profile.takeaway_enabled !== false ? "takeaway" : "delivery"
  );
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false); // never default true
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "mobile_money" | "card">("cash");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [placedOrder, setPlacedOrder] = useState<{ id: string; order_number: number } | null>(null);
  const [orderStatus, setOrderStatus] = useState<any>(null);

  const closed = !isOpenNow(profile.opening_hours);
  const orderingOpen = profile.ordering_enabled !== false;

  const availableOrderTypes = (
    [
      table && profile.dine_in_enabled !== false && { id: "dine_in" as const, label: t.restaurant.dineInLabel },
      profile.takeaway_enabled !== false && { id: "takeaway" as const, label: t.restaurant.takeawayLabel },
      profile.delivery_enabled && { id: "delivery" as const, label: t.restaurant.deliveryLabel },
    ] as const
  ).filter(Boolean) as { id: OrderType; label: string }[];

  const addToCart = (item: any) => {
    setCart((prev) => {
      const existing = prev.find((l) => l.menuItemId === item.id && !l.notes);
      if (existing) return prev.map((l) => (l === existing ? { ...l, quantity: l.quantity + 1 } : l));
      return [...prev, { menuItemId: item.id, name: item.name, price: Number(item.price), quantity: 1, notes: "" }];
    });
  };
  const changeQty = (idx: number, delta: number) => {
    setCart((prev) => {
      const next = [...prev];
      const line = next[idx];
      const qty = line.quantity + delta;
      if (qty <= 0) return next.filter((_, i) => i !== idx);
      next[idx] = { ...line, quantity: qty };
      return next;
    });
  };
  const changeNote = (idx: number, notes: string) => {
    setCart((prev) => prev.map((l, i) => (i === idx ? { ...l, notes } : l)));
  };

  const subtotal = cart.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const deliveryFee = orderType === "delivery" ? Number(profile.delivery_fee) || 0 : 0;
  const total = subtotal + deliveryFee;
  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  const placeOrder = async () => {
    setError("");
    if (!name.trim() || !phone.trim()) {
      setError(t.restaurant.orderRequiredError);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: profile.id,
          table_id: table?.id || null,
          order_type: orderType,
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          delivery_address: deliveryAddress.trim(),
          marketing_opt_in: marketingOptIn,
          payment_method: paymentMethod,
          items: cart.map((l) => ({ menu_item_id: l.menuItemId, quantity: l.quantity, notes: l.notes })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || t.restaurant.orderFailedError);
        return;
      }
      setPlacedOrder({ id: data.id, order_number: data.order_number });
      setStep("confirmation");
    } catch {
      setError(t.restaurant.orderFailedError);
    } finally {
      setSubmitting(false);
    }
  };

  // Polls every 4s for a live status readout — no Realtime dependency,
  // works regardless of whether it's enabled on this Supabase project.
  useEffect(() => {
    if (!placedOrder) return;
    const poll = async () => {
      try {
        const res = await fetch(`/api/orders/${placedOrder.id}`);
        if (res.ok) setOrderStatus(await res.json());
      } catch {
        // transient network error — next tick tries again
      }
    };
    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [placedOrder]);

  const subcategoryLabel = getRestaurantSubcategory(profile.restaurant_subcategory)?.label[locale];

  const statusMessage = (status: string) =>
    ({
      pending: t.restaurant.statusPending,
      accepted: t.restaurant.statusAccepted,
      preparing: t.restaurant.statusPreparing,
      ready: t.restaurant.statusReady,
      served: t.restaurant.statusServed,
      completed: t.restaurant.statusCompleted,
      cancelled: t.restaurant.statusCancelled,
      refunded: t.restaurant.statusRefunded,
    }[status] || status);

  if (step === "confirmation" && placedOrder) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center px-4 py-10" style={{ color: "#14202B" }}>
        <div className="w-full max-w-md flex flex-col items-center gap-4 text-center">
          <span className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accent}1a` }}>
            <Check size={28} style={{ color: accent }} />
          </span>
          <h1 className="font-display text-xl font-bold">{t.restaurant.orderConfirmedTitle}</h1>
          {orderStatus && (
            <p className="text-sm" style={{ opacity: 0.75 }}>
              {statusMessage(orderStatus.status)}
            </p>
          )}

          <div id="receipt" className="w-full rounded-2xl border p-4 text-left mt-2" style={{ borderColor: "#E5E7EB" }}>
            <div className="flex items-center justify-between mb-1">
              <p className="font-semibold">{profile.name || profile.username}</p>
              <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: `${accent}1a`, color: accent }}>
                {orderStatus ? statusMessage(orderStatus.status).split(" ")[0] : "…"}
              </span>
            </div>
            <p className="text-xs mb-3" style={{ opacity: 0.6 }}>
              {t.restaurant.orderNumberLabel} #{placedOrder.order_number}
              {table && ` · ${t.restaurant.tableLabel} ${table.label}`}
            </p>
            <div className="flex flex-col gap-1.5 text-sm border-t pt-3" style={{ borderColor: "#E5E7EB" }}>
              {cart.map((l, i) => (
                <div key={i} className="flex justify-between">
                  <span>
                    {l.quantity} × {l.name}
                  </span>
                  <span suppressHydrationWarning>{formatPrice(l.price * l.quantity, currency, locale)}</span>
                </div>
              ))}
              {deliveryFee > 0 && (
                <div className="flex justify-between" style={{ opacity: 0.7 }}>
                  <span>{t.restaurant.deliveryFeeLine}</span>
                  <span suppressHydrationWarning>{formatPrice(deliveryFee, currency, locale)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold pt-1.5 mt-1 border-t" style={{ borderColor: "#E5E7EB" }}>
                <span>{t.restaurant.totalLabel}</span>
                <span suppressHydrationWarning>{formatPrice(total, currency, locale)}</span>
              </div>
            </div>
          </div>

          <button
            onClick={() => window.print()}
            className="text-sm font-medium px-4 py-2.5 rounded-full mt-2"
            style={{ border: "1.5px solid #E5E7EB" }}
          >
            {t.restaurant.printReceipt}
          </button>
          <Link href={`/${profile.username}`} className="text-sm font-medium mt-1" style={{ color: accent }}>
            {t.restaurant.backToMenu}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white pb-28" style={{ color: "#14202B" }}>
      <div className="sticky top-0 z-20 bg-white border-b flex items-center gap-3 px-4 py-3" style={{ borderColor: "#E5E7EB" }}>
        <Link href={`/${profile.username}`} className="shrink-0">
          <ArrowLeft size={19} />
        </Link>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{profile.name || profile.username}</p>
          {table && (
            <p className="text-xs" style={{ opacity: 0.6 }}>
              {t.restaurant.tableIdentified(table.label)}
            </p>
          )}
        </div>
        {itemCount > 0 && step === "menu" && (
          <button onClick={() => setShowCart(true)} className="relative shrink-0">
            <ShoppingCart size={20} />
            <span
              className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center text-white"
              style={{ backgroundColor: accent }}
            >
              {itemCount}
            </span>
          </button>
        )}
      </div>

      {!orderingOpen && (
        <p className="text-sm text-center py-6 px-4" style={{ opacity: 0.7 }}>
          {t.restaurant.currentlyUnavailable}
        </p>
      )}

      {orderingOpen && step === "menu" && (
        <div className="max-w-md mx-auto px-4 py-5 flex flex-col gap-6">
          {closed && (
            <p
              className="text-xs font-medium text-center py-2 rounded-full"
              style={{ backgroundColor: "#FEE2E2", color: "#991B1B" }}
            >
              {t.restaurant.closedNow}
            </p>
          )}

          {categories.map((category) => {
            const catItems = itemsByCategory(category.id);
            if (catItems.length === 0) return null;
            return (
              <div key={category.id} className="flex flex-col gap-2.5">
                <p className="text-base font-bold">{category.name}</p>
                {catItems.map((item) => (
                  <MenuItemCard key={item.id} item={item} currency={currency} locale={locale} accent={accent} onAdd={() => addToCart(item)} t={t} />
                ))}
              </div>
            );
          })}

          {uncategorized.length > 0 && (
            <div className="flex flex-col gap-2.5">
              {uncategorized.map((item) => (
                <MenuItemCard key={item.id} item={item} currency={currency} locale={locale} accent={accent} onAdd={() => addToCart(item)} t={t} />
              ))}
            </div>
          )}

          {items.length === 0 && <p className="text-sm text-center py-10" style={{ opacity: 0.5 }}>{t.restaurant.noItemsYet}</p>}
        </div>
      )}

      {orderingOpen && step === "checkout" && (
        <div className="max-w-md mx-auto px-4 py-5 flex flex-col gap-4">
          <button onClick={() => setStep("menu")} className="flex items-center gap-1.5 text-sm" style={{ opacity: 0.7 }}>
            <ArrowLeft size={15} />
            {t.restaurant.backToMenu}
          </button>

          <h1 className="font-display text-xl font-bold">{t.restaurant.checkoutTitle}</h1>

          {error && <p className="text-sm px-3.5 py-2.5 rounded-card" style={{ backgroundColor: "#FEE2E2", color: "#991B1B" }}>{error}</p>}

          {availableOrderTypes.length > 1 && (
            <div>
              <p className="text-xs font-medium mb-1.5" style={{ opacity: 0.7 }}>{t.restaurant.orderTypeLabel}</p>
              <div className="flex gap-2">
                {availableOrderTypes.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setOrderType(o.id)}
                    className="flex-1 text-xs font-medium py-2 rounded-full border transition"
                    style={
                      orderType === o.id
                        ? { backgroundColor: accent, color: "#fff", border: "1.5px solid transparent" }
                        : { border: "1.5px solid #E5E7EB" }
                    }
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ opacity: 0.7 }}>{t.restaurant.nameLabel}</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t.restaurant.namePlaceholder}
              className="border rounded-card px-3.5 py-2.5 text-sm"
              style={{ borderColor: "#E5E7EB" }}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ opacity: 0.7 }}>{t.restaurant.phoneLabel}</span>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t.restaurant.phonePlaceholder}
              inputMode="tel"
              className="border rounded-card px-3.5 py-2.5 text-sm"
              style={{ borderColor: "#E5E7EB" }}
            />
          </label>

          {orderType === "delivery" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium" style={{ opacity: 0.7 }}>{t.restaurant.deliveryAddressLabel}</span>
              <textarea
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                placeholder={t.restaurant.deliveryAddressPlaceholder}
                rows={2}
                className="border rounded-card px-3.5 py-2.5 text-sm resize-none"
                style={{ borderColor: "#E5E7EB" }}
              />
            </label>
          )}

          <div>
            <p className="text-xs font-medium mb-1.5" style={{ opacity: 0.7 }}>{t.restaurant.paymentMethodLabel}</p>
            <div className="flex gap-2">
              {(
                [
                  ["cash", t.restaurant.paymentCash],
                  ["mobile_money", t.restaurant.paymentMobileMoney],
                  ["card", t.restaurant.paymentCard],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setPaymentMethod(id)}
                  className="flex-1 text-xs font-medium py-2 rounded-full border transition"
                  style={
                    paymentMethod === id
                      ? { backgroundColor: accent, color: "#fff", border: "1.5px solid transparent" }
                      : { border: "1.5px solid #E5E7EB" }
                  }
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Never checked by default — see the migration's comment on
              customer_marketing_consent. Placing an order is not consent. */}
          <label className="flex items-start gap-2 text-xs" style={{ opacity: 0.8 }}>
            <input
              type="checkbox"
              checked={marketingOptIn}
              onChange={(e) => setMarketingOptIn(e.target.checked)}
              className="mt-0.5"
              style={{ accentColor: accent }}
            />
            {t.restaurant.marketingOptInLabel}
          </label>

          <div className="rounded-card border p-3.5 flex flex-col gap-1.5 text-sm" style={{ borderColor: "#E5E7EB" }}>
            <div className="flex justify-between" style={{ opacity: 0.7 }}>
              <span>{t.restaurant.subtotalLabel}</span>
              <span suppressHydrationWarning>{formatPrice(subtotal, currency, locale)}</span>
            </div>
            {deliveryFee > 0 && (
              <div className="flex justify-between" style={{ opacity: 0.7 }}>
                <span>{t.restaurant.deliveryFeeLine}</span>
                <span suppressHydrationWarning>{formatPrice(deliveryFee, currency, locale)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold pt-1.5 mt-1 border-t" style={{ borderColor: "#E5E7EB" }}>
              <span>{t.restaurant.totalLabel}</span>
              <span suppressHydrationWarning>{formatPrice(total, currency, locale)}</span>
            </div>
          </div>

          <button
            onClick={placeOrder}
            disabled={submitting}
            className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold disabled:opacity-60"
            style={{ backgroundColor: accent, color: "#fff" }}
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {submitting ? t.restaurant.placingOrder : t.restaurant.placeOrderButton}
          </button>
        </div>
      )}

      {showCart && step === "menu" && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setShowCart(false)}>
          <div
            className="w-full max-w-md bg-white rounded-t-3xl p-4 max-h-[80vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-3">
              <p className="font-bold">{t.restaurant.cartTitle}</p>
              <button onClick={() => setShowCart(false)}>
                <X size={18} />
              </button>
            </div>
            {cart.length === 0 ? (
              <p className="text-sm py-8 text-center" style={{ opacity: 0.6 }}>
                {t.restaurant.cartEmpty}
              </p>
            ) : (
              <div className="flex flex-col gap-3">
                {cart.map((line, idx) => (
                  <div key={idx} className="flex flex-col gap-1.5 border-b pb-3" style={{ borderColor: "#E5E7EB" }}>
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium flex-1 min-w-0 truncate">{line.name}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => changeQty(idx, -1)} className="w-6 h-6 rounded-full border flex items-center justify-center" style={{ borderColor: "#E5E7EB" }}>
                          <Minus size={11} />
                        </button>
                        <span className="text-sm w-4 text-center">{line.quantity}</span>
                        <button onClick={() => changeQty(idx, 1)} className="w-6 h-6 rounded-full border flex items-center justify-center" style={{ borderColor: "#E5E7EB" }}>
                          <Plus size={11} />
                        </button>
                      </div>
                    </div>
                    <input
                      value={line.notes}
                      onChange={(e) => changeNote(idx, e.target.value)}
                      placeholder={t.restaurant.itemNotePlaceholder}
                      className="text-xs border rounded-card px-2.5 py-1.5"
                      style={{ borderColor: "#E5E7EB" }}
                    />
                  </div>
                ))}
                <button
                  onClick={() => {
                    setShowCart(false);
                    setStep("checkout");
                  }}
                  className="mt-1 py-3 rounded-full text-sm font-semibold text-white"
                  style={{ backgroundColor: accent }}
                >
                  {t.restaurant.cartReview} · <span suppressHydrationWarning>{formatPrice(subtotal, currency, locale)}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {itemCount > 0 && step === "menu" && !showCart && (
        <button
          onClick={() => setShowCart(true)}
          className="fixed bottom-5 left-4 right-4 max-w-md mx-auto flex items-center justify-between px-5 py-3.5 rounded-full text-white shadow-lg z-20"
          style={{ backgroundColor: accent }}
        >
          <span className="text-sm font-semibold">{itemCount} · {t.restaurant.cartTitle}</span>
          <span className="text-sm font-bold" suppressHydrationWarning>{formatPrice(subtotal, currency, locale)}</span>
        </button>
      )}
    </div>
  );
}

function MenuItemCard({ item, currency, locale, accent, onAdd, t }: { item: any; currency: string; locale: string; accent: string; onAdd: () => void; t: any }) {
  const unavailable = item.available === false;
  return (
    <div className="flex gap-3 rounded-2xl border p-2.5" style={{ borderColor: "#E5E7EB", opacity: unavailable ? 0.55 : 1 }}>
      {item.image_urls?.length || item.image_url ? (
        <ImageGallery
          images={item.image_urls?.length ? item.image_urls : [item.image_url]}
          alt={item.name}
          className="w-20 h-20 rounded-xl shrink-0"
          imgClassName="object-cover"
        />
      ) : (
        <div className="w-20 h-20 rounded-xl shrink-0" style={{ backgroundColor: "#F3F4F6" }} />
      )}
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-0.5">
        <p className="text-sm font-semibold truncate">{item.name}</p>
        {item.description && (
          <p className="text-xs line-clamp-2" style={{ opacity: 0.6 }}>
            {item.description}
          </p>
        )}
        <p className="text-sm font-bold mt-0.5" style={{ color: accent }} suppressHydrationWarning>
          {formatPrice(item.price, currency, locale)}
        </p>
      </div>
      {unavailable ? (
        <span className="self-center shrink-0 text-[11px] px-2.5 py-1 rounded-full" style={{ backgroundColor: "#F3F4F6", opacity: 0.7 }}>
          {t.restaurant.currentlyUnavailable}
        </span>
      ) : (
        <button
          onClick={onAdd}
          className="self-center shrink-0 text-xs font-semibold px-3 py-2 rounded-full text-white"
          style={{ backgroundColor: accent }}
        >
          {t.restaurant.addToOrder}
        </button>
      )}
    </div>
  );
}
