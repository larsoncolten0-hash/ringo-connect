"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ShoppingCart, X, Plus, Minus, Play, Pause, Download, Check, Loader2, Heart } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { formatPrice } from "@/lib/currency";
import { getMusicRole } from "@/lib/categories";
import ImageGallery from "@/components/ImageGallery";
import { useTrackPlayback } from "./useTrackPlayback";

type ItemType = "song" | "release" | "merch" | "ticket" | "support";
type CartLine = { itemType: ItemType; id?: string; name: string; price: number; quantity: number; coverUrl?: string };

export default function MusicStorePage({ profile }: { profile: any }) {
  const { t, locale } = useLanguage();
  const searchParams = useSearchParams();
  const accent = profile.theme_color || "#F2B705";
  const currency = profile.currency || "USD";

  const standaloneTracks: any[] = (profile.tracks || []).filter((tr: any) => tr.available !== false && !tr.release_id && tr.price);
  const releases: any[] = (profile.music_releases || []).filter((r: any) => r.available !== false);
  const merch: any[] = (profile.products || []).filter((p: any) => p.available !== false);
  const tickets: any[] = (profile.events || []).filter((e: any) => e.price);

  // A song for sale shows a play button for its 30-second preview (or the
  // full audio_url, for a track that isn't protected/gated) right on its
  // store card — same rule useTrackPlayback already enforces elsewhere
  // (Latest Music, Pinned Spotlight): a protected track can only ever
  // play its preview clip here, never the full file.
  const { playingId, togglePlay } = useTrackPlayback();

  const [cart, setCart] = useState<CartLine[]>([]);
  const [showCart, setShowCart] = useState(false);
  const [step, setStep] = useState<"store" | "checkout" | "confirmation">("store");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "mobile_money" | "card">("mobile_money");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [placedOrder, setPlacedOrder] = useState<{ id: string; order_number: number } | null>(null);
  const [orderDetail, setOrderDetail] = useState<any>(null);

  // A "Support the Artist" amount arrives as ?support=<amount> from the
  // public profile's Support widget — pre-loads the cart with that one
  // line so the fan lands straight in a normal checkout for it, the same
  // flow as any other purchase (so it gets a real order, receipt, and
  // shows up in the artist's analytics, unlike the old WhatsApp-only version).
  useEffect(() => {
    const supportAmount = Number(searchParams.get("support"));
    if (supportAmount > 0) {
      setCart((prev) => [...prev, { itemType: "support", name: "Artist Support", price: supportAmount, quantity: 1 }]);
      setShowCart(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addToCart = (line: CartLine) => setCart((prev) => [...prev, line]);
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

  const total = cart.reduce((sum, l) => sum + l.price * l.quantity, 0);
  const itemCount = cart.reduce((sum, l) => sum + l.quantity, 0);

  const placeOrder = async () => {
    setError("");
    if (!name.trim() || !phone.trim()) {
      setError(t.restaurant.orderRequiredError);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/music/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profile_id: profile.id,
          customer_name: name.trim(),
          customer_phone: phone.trim(),
          customer_email: email.trim(),
          payment_method: paymentMethod,
          items: cart.map((l) => ({ item_type: l.itemType, id: l.id, quantity: l.quantity, amount: l.itemType === "support" ? l.price : undefined })),
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

  useEffect(() => {
    if (!placedOrder) return;
    fetch(`/api/music/orders/${placedOrder.id}`)
      .then((r) => r.json())
      .then(setOrderDetail)
      .catch(() => {});
  }, [placedOrder]);

  const musicSectionLabel = getMusicRole(profile.music_role)?.sectionLabel[locale] || t.music.storeMusicHeading;

  if (step === "confirmation" && placedOrder) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center px-4 py-10" style={{ color: "#14202B" }}>
        <div className="w-full max-w-md flex flex-col items-center gap-4 text-center">
          <span className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accent}22` }}>
            <Check size={28} style={{ color: accent }} />
          </span>
          <h1 className="font-display text-xl font-bold">{t.music.purchaseSuccessfulTitle}</h1>
          <p className="text-sm" style={{ opacity: 0.6 }}>
            {t.restaurant.orderNumberLabel} #{placedOrder.order_number}
          </p>

          {orderDetail?.items?.some((i: any) => i.item_type === "song" || i.item_type === "release") && (
            <p className="text-xs" style={{ opacity: 0.6 }}>{t.music.emailDeliveryNote}</p>
          )}

          <div className="w-full flex flex-col gap-3 mt-2">
            {(orderDetail?.items || []).map((item: any) => (
              <PurchasedItem key={item.id} item={item} orderId={placedOrder.id} accent={accent} currency={currency} locale={locale} t={t} />
            ))}
          </div>

          <Link href={`/${profile.username}`} className="text-sm font-medium mt-4" style={{ color: accent }}>
            {t.music.backToProfile}
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
        <p className="text-sm font-semibold flex-1 truncate">{profile.name || profile.username}</p>
        {itemCount > 0 && step === "store" && (
          <button onClick={() => setShowCart(true)} className="relative shrink-0">
            <ShoppingCart size={20} />
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center text-white" style={{ backgroundColor: accent }}>
              {itemCount}
            </span>
          </button>
        )}
      </div>

      {step === "store" && (
        <div className="max-w-md mx-auto px-4 py-5 flex flex-col gap-8">
          {standaloneTracks.length === 0 && releases.length === 0 && merch.length === 0 && tickets.length === 0 && (
            <p className="text-sm text-center py-10" style={{ opacity: 0.5 }}>—</p>
          )}

          {(standaloneTracks.length > 0 || releases.length > 0) && (
            <div className="flex flex-col gap-3">
              <p className="text-base font-bold">{musicSectionLabel}</p>
              {releases.map((r) => (
                <StoreCard
                  key={r.id}
                  image={r.cover_image_url}
                  name={r.title}
                  price={r.price}
                  currency={currency}
                  locale={locale}
                  accent={accent}
                  ctaLabel={r.release_type === "album" ? t.music.buyAlbum : t.music.buyEp}
                  onAdd={() => addToCart({ itemType: "release", id: r.id, name: r.title, price: Number(r.price), quantity: 1, coverUrl: r.cover_image_url })}
                />
              ))}
              {standaloneTracks.map((tr) => (
                <StoreCard
                  key={tr.id}
                  image={tr.cover_image_url}
                  name={tr.title}
                  price={tr.price}
                  currency={currency}
                  locale={locale}
                  accent={accent}
                  ctaLabel={t.music.buySong}
                  onAdd={() => addToCart({ itemType: "song", id: tr.id, name: tr.title, price: Number(tr.price), quantity: 1, coverUrl: tr.cover_image_url })}
                  hasPreview={!!(tr.preview_audio_url || tr.audio_url)}
                  isPlaying={playingId === tr.id}
                  onTogglePlay={() => togglePlay(tr)}
                />
              ))}
            </div>
          )}

          {merch.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-base font-bold">{t.music.storeMerchHeading}</p>
              <div className="grid grid-cols-2 gap-3">
                {merch.map((p) => {
                  const soldOut = p.inventory_count === 0;
                  return (
                    <div key={p.id} className="rounded-2xl overflow-hidden" style={{ border: "1px solid #E5E7EB", opacity: soldOut ? 0.5 : 1 }}>
                      {p.image_urls?.length || p.image_url ? (
                        <ImageGallery
                          images={p.image_urls?.length ? p.image_urls : [p.image_url]}
                          alt={p.name}
                          className="w-full aspect-square"
                          imgClassName="object-cover"
                        />
                      ) : (
                        <div className="w-full aspect-square" style={{ backgroundColor: "#F3F4F6" }} />
                      )}
                      <div className="p-2.5">
                        <p className="text-xs font-semibold truncate">{p.name}</p>
                        <p className="text-xs font-bold mt-0.5" style={{ color: accent }} suppressHydrationWarning>
                          {formatPrice(p.price, currency, locale)}
                        </p>
                        <button
                          disabled={soldOut}
                          onClick={() => addToCart({ itemType: "merch", id: p.id, name: p.name, price: Number(p.price) || 0, quantity: 1, coverUrl: p.image_url })}
                          className="w-full mt-2 text-xs font-semibold py-1.5 rounded-full text-white disabled:opacity-50"
                          style={{ backgroundColor: accent }}
                        >
                          {soldOut ? t.music.soldOut : t.music.shopMerch}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tickets.length > 0 && (
            <div className="flex flex-col gap-3">
              <p className="text-base font-bold">{t.music.storeTicketsHeading}</p>
              {tickets.map((e) => {
                const remaining = e.ticket_capacity != null ? e.ticket_capacity - (e.tickets_sold || 0) : null;
                const soldOut = remaining !== null && remaining <= 0;
                return (
                  <div key={e.id} className="flex items-center gap-3 rounded-2xl p-2.5" style={{ border: "1px solid #E5E7EB", opacity: soldOut ? 0.5 : 1 }}>
                    {e.cover_image_url ? <img src={e.cover_image_url} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" /> : <div className="w-14 h-14 rounded-xl shrink-0" style={{ backgroundColor: "#F3F4F6" }} />}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{e.title}</p>
                      <p className="text-xs" style={{ opacity: 0.6 }}>{[e.location, e.event_date].filter(Boolean).join(" · ")}</p>
                      <p className="text-sm font-bold" style={{ color: accent }} suppressHydrationWarning>{formatPrice(e.price, currency, locale)}</p>
                    </div>
                    <button
                      disabled={soldOut}
                      onClick={() => addToCart({ itemType: "ticket", id: e.id, name: e.title, price: Number(e.price), quantity: 1, coverUrl: e.cover_image_url })}
                      className="shrink-0 text-xs font-semibold px-3.5 py-2 rounded-full text-white disabled:opacity-50"
                      style={{ backgroundColor: accent }}
                    >
                      {soldOut ? t.music.soldOut : t.music.getTicketButton}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {step === "checkout" && (
        <div className="max-w-md mx-auto px-4 py-5 flex flex-col gap-4">
          <button onClick={() => setStep("store")} className="flex items-center gap-1.5 text-sm" style={{ opacity: 0.7 }}>
            <ArrowLeft size={15} /> {t.restaurant.backToMenu}
          </button>
          <h1 className="font-display text-xl font-bold">{t.restaurant.checkoutTitle}</h1>
          {error && <p className="text-sm px-3.5 py-2.5 rounded-card" style={{ backgroundColor: "#FEE2E2", color: "#991B1B" }}>{error}</p>}

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ opacity: 0.7 }}>{t.restaurant.nameLabel}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t.restaurant.namePlaceholder} className="border rounded-card px-3.5 py-2.5 text-sm" style={{ borderColor: "#E5E7EB" }} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ opacity: 0.7 }}>{t.restaurant.phoneLabel}</span>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={t.restaurant.phonePlaceholder} inputMode="tel" className="border rounded-card px-3.5 py-2.5 text-sm" style={{ borderColor: "#E5E7EB" }} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium" style={{ opacity: 0.7 }}>{t.music.emailLabel}</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.music.emailPlaceholder} inputMode="email" className="border rounded-card px-3.5 py-2.5 text-sm" style={{ borderColor: "#E5E7EB" }} />
          </label>

          <div>
            <p className="text-xs font-medium mb-1.5" style={{ opacity: 0.7 }}>{t.restaurant.paymentMethodLabel}</p>
            <div className="flex gap-2">
              {([["cash", t.restaurant.paymentCash], ["mobile_money", t.restaurant.paymentMobileMoney], ["card", t.restaurant.paymentCard]] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setPaymentMethod(id)}
                  className="flex-1 text-xs font-medium py-2 rounded-full border transition"
                  style={paymentMethod === id ? { backgroundColor: accent, color: "#fff", border: "1.5px solid transparent" } : { border: "1.5px solid #E5E7EB" }}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-card border p-3.5 flex flex-col gap-1.5 text-sm" style={{ borderColor: "#E5E7EB" }}>
            {cart.map((l, i) => (
              <div key={i} className="flex justify-between" style={{ opacity: 0.75 }}>
                <span>{l.quantity} × {l.name}</span>
                <span suppressHydrationWarning>{formatPrice(l.price * l.quantity, currency, locale)}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold pt-1.5 mt-1 border-t" style={{ borderColor: "#E5E7EB" }}>
              <span>{t.restaurant.totalLabel}</span>
              <span suppressHydrationWarning>{formatPrice(total, currency, locale)}</span>
            </div>
          </div>

          <button
            onClick={placeOrder}
            disabled={submitting}
            className="flex items-center justify-center gap-2 py-3 rounded-full text-sm font-semibold text-white disabled:opacity-60"
            style={{ backgroundColor: accent }}
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            {submitting ? t.restaurant.placingOrder : t.restaurant.placeOrderButton}
          </button>
        </div>
      )}

      {showCart && step === "store" && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/40" onClick={() => setShowCart(false)}>
          <div className="w-full max-w-md bg-white rounded-t-3xl p-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-bold">{t.restaurant.cartTitle}</p>
              <button onClick={() => setShowCart(false)}><X size={18} /></button>
            </div>
            {cart.length === 0 ? (
              <p className="text-sm py-8 text-center" style={{ opacity: 0.6 }}>{t.music.cartEmptyMusic}</p>
            ) : (
              <div className="flex flex-col gap-3">
                {cart.map((line, idx) => (
                  <div key={idx} className="flex items-center justify-between gap-2 border-b pb-3" style={{ borderColor: "#E5E7EB" }}>
                    <p className="text-sm font-medium flex-1 min-w-0 truncate">{line.name}</p>
                    {line.itemType === "merch" || line.itemType === "ticket" ? (
                      <div className="flex items-center gap-2 shrink-0">
                        <button onClick={() => changeQty(idx, -1)} className="w-6 h-6 rounded-full border flex items-center justify-center" style={{ borderColor: "#E5E7EB" }}><Minus size={11} /></button>
                        <span className="text-sm w-4 text-center">{line.quantity}</span>
                        <button onClick={() => changeQty(idx, 1)} className="w-6 h-6 rounded-full border flex items-center justify-center" style={{ borderColor: "#E5E7EB" }}><Plus size={11} /></button>
                      </div>
                    ) : (
                      <button onClick={() => setCart((prev) => prev.filter((_, i) => i !== idx))} className="shrink-0" style={{ opacity: 0.5 }}><X size={14} /></button>
                    )}
                    <span className="text-sm font-semibold shrink-0" suppressHydrationWarning>{formatPrice(line.price * line.quantity, currency, locale)}</span>
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
                  {t.restaurant.cartReview} · <span suppressHydrationWarning>{formatPrice(total, currency, locale)}</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {itemCount > 0 && step === "store" && !showCart && (
        <button
          onClick={() => setShowCart(true)}
          className="fixed bottom-5 left-4 right-4 max-w-md mx-auto flex items-center justify-between px-5 py-3.5 rounded-full text-white shadow-lg z-20"
          style={{ backgroundColor: accent }}
        >
          <span className="text-sm font-semibold">{itemCount} · {t.restaurant.cartTitle}</span>
          <span className="text-sm font-bold" suppressHydrationWarning>{formatPrice(total, currency, locale)}</span>
        </button>
      )}
    </div>
  );
}

function StoreCard({
  image,
  name,
  price,
  currency,
  locale,
  accent,
  ctaLabel,
  onAdd,
  hasPreview,
  isPlaying,
  onTogglePlay,
}: {
  image?: string;
  name: string;
  price: number;
  currency: string;
  locale: string;
  accent: string;
  ctaLabel: string;
  onAdd: () => void;
  // Play button for a 30-second preview clip — only songs carry one
  // (releases are a bundle of tracks, not a single audio file to play).
  hasPreview?: boolean;
  isPlaying?: boolean;
  onTogglePlay?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl p-2.5" style={{ border: "1px solid #E5E7EB" }}>
      {image ? <img src={image} alt="" className="w-14 h-14 rounded-xl object-cover shrink-0" /> : <div className="w-14 h-14 rounded-xl shrink-0" style={{ backgroundColor: "#F3F4F6" }} />}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{name}</p>
        <p className="text-sm font-bold" style={{ color: accent }} suppressHydrationWarning>{formatPrice(price, currency, locale)}</p>
      </div>
      {hasPreview && onTogglePlay && (
        <button
          onClick={onTogglePlay}
          aria-label={isPlaying ? "Pause" : "Play"}
          className="shrink-0 w-9 h-9 rounded-full flex items-center justify-center border"
          style={{ borderColor: "#E5E7EB", color: accent }}
        >
          {isPlaying ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
        </button>
      )}
      <button onClick={onAdd} className="shrink-0 text-xs font-semibold px-3.5 py-2 rounded-full text-white" style={{ backgroundColor: accent }}>
        {ctaLabel}
      </button>
    </div>
  );
}

// Post-purchase access — Play/Download call the protected-audio route,
// which mints a short-lived signed URL only after re-verifying this exact
// order paid for this exact track (see /api/music/tracks/[id]/audio).
function PurchasedItem({ item, orderId, accent, currency, locale, t }: { item: any; orderId: string; accent: string; currency: string; locale: string; t: any }) {
  const [playing, setPlaying] = useState(false);
  const [audio] = useState(() => (typeof Audio !== "undefined" ? new Audio() : null));
  const [loading, setLoading] = useState<"play" | "download" | null>(null);

  const isMusic = item.item_type === "song" || item.item_type === "release";

  const fetchSignedUrl = async (download: boolean) => {
    if (!item.track_id) return null;
    const res = await fetch(`/api/music/tracks/${item.track_id}/audio?order=${orderId}`, {
      headers: download ? { "x-download": "1" } : undefined,
    });
    const data = await res.json();
    if (!res.ok) return null;
    return data.url as string;
  };

  const togglePlay = async () => {
    if (playing) {
      audio?.pause();
      setPlaying(false);
      return;
    }
    setLoading("play");
    const url = await fetchSignedUrl(false);
    setLoading(null);
    if (!url || !audio) return;
    audio.src = url;
    audio.onended = () => setPlaying(false);
    await audio.play();
    setPlaying(true);
  };

  const download = async () => {
    setLoading("download");
    const url = await fetchSignedUrl(true);
    setLoading(null);
    if (url) window.open(url, "_blank");
  };

  return (
    <div className="w-full rounded-2xl p-3 flex items-center gap-3 text-left" style={{ border: "1px solid #E5E7EB" }}>
      {item.item_type === "support" ? (
        <span className="w-10 h-10 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}22` }}>
          <Heart size={16} style={{ color: accent }} />
        </span>
      ) : null}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold truncate">{item.name}</p>
        <p className="text-xs" style={{ opacity: 0.6 }} suppressHydrationWarning>
          {formatPrice(item.price, currency, locale)}
        </p>
      </div>
      {isMusic && item.track_id && (
        <div className="flex gap-1.5 shrink-0">
          <button onClick={togglePlay} disabled={loading === "play"} className="w-9 h-9 rounded-full flex items-center justify-center text-white disabled:opacity-60" style={{ backgroundColor: accent }}>
            {loading === "play" ? <Loader2 size={14} className="animate-spin" /> : playing ? <Pause size={14} /> : <Play size={14} className="ml-0.5" />}
          </button>
          <button onClick={download} disabled={loading === "download"} className="w-9 h-9 rounded-full flex items-center justify-center border" style={{ borderColor: "#E5E7EB" }}>
            {loading === "download" ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          </button>
        </div>
      )}
    </div>
  );
}
