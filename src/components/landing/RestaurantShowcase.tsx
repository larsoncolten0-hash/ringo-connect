"use client";

import { Clock, UtensilsCrossed, Bike, Store } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";

// A larger, more detailed static demo than the hero's compact mockup —
// mirrors the real Restaurant & Food public page and menu almost exactly
// (same white/green palette, same menu-item card shape, same dine-in/
// takeaway/delivery framing) so this section and the actual product feel
// like the same thing.
const MENU_CATEGORIES = [
  { name: "Main Dishes", items: [{ name: "Grilled Chicken", price: "5,000 FCFA" }, { name: "Beef Burger", price: "4,000 FCFA" }] },
  { name: "Drinks", items: [{ name: "Fresh Juice", price: "1,500 FCFA" }] },
];

export default function RestaurantShowcase() {
  const { t } = useLanguage();
  const green = "#1F9D55";

  return (
    <div className="rounded-[28px] overflow-hidden border border-ringo-border/70 bg-white text-[#14202B] max-w-md mx-auto">
      <div className="p-5">
        <div className="flex items-center justify-between mb-4">
          <p className="font-display font-bold">ABC RESTAURANT</p>
          <span className="text-xs font-medium px-2.5 py-1 rounded-full flex items-center gap-1.5" style={{ backgroundColor: "#DCFCE7", color: "#166534" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-[#22C55E]" />
            {t.restaurant.openNow}
          </span>
        </div>

        <div className="flex items-center gap-2 text-xs mb-4" style={{ opacity: 0.65 }}>
          <Clock size={13} />
          11:00 — 22:00
        </div>

        <div className="flex gap-2 mb-5">
          {[
            { icon: UtensilsCrossed, label: t.restaurant.dineInLabel },
            { icon: Store, label: t.restaurant.takeawayLabel },
            { icon: Bike, label: t.restaurant.deliveryLabel },
          ].map((o) => (
            <span key={o.label} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-medium py-2 rounded-full" style={{ border: "1.5px solid #E5E7EB" }}>
              <o.icon size={12} />
              {o.label}
            </span>
          ))}
        </div>

        {MENU_CATEGORIES.map((cat) => (
          <div key={cat.name} className="mb-4 last:mb-0">
            <p className="text-sm font-bold mb-2">{cat.name}</p>
            <div className="flex flex-col gap-2">
              {cat.items.map((item) => (
                <div key={item.name} className="flex items-center gap-3 rounded-2xl p-2" style={{ border: "1px solid #E5E7EB" }}>
                  <div className="w-12 h-12 rounded-xl shrink-0" style={{ backgroundColor: "#F3F4F6" }} />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{item.name}</p>
                    <p className="text-sm font-bold" style={{ color: green }}>
                      {item.price}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-white px-3 py-1.5 rounded-full" style={{ backgroundColor: green }}>
                    +
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
