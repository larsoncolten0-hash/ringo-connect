"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Reorder } from "framer-motion";
import { ShoppingBag } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { useSectionSave } from "@/components/dashboard/sectionSave";
import { useAutosave } from "@/components/dashboard/sectionAutosave";
import { getCategory, profileHasCategory } from "@/lib/categories";
import { isCtaPresetId, normalizeCtaLabel } from "@/lib/cta";
import { checkProductEligibility } from "@/lib/productCheckout/eligibility";
import EditorCard from "./EditorCard";
import EmptyState from "./EmptyState";
import ProductRow from "./ProductRow";
import CurrencySelect from "./CurrencySelect";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useEditorPreview } from "./EditorPreviewContext";
import { useAutosavedRows } from "./useAutosavedRows";
import { planProductsSave } from "./productsSave";
import { countHidden } from "@/lib/planEntitlements";
import PlanCta from "@/components/ui/PlanCta";

export default function CatalogCard({
  profileId,
  userId,
  initialProducts,
  catalogLocked,
  maxProducts,
  initialCurrency,
  communityEnabled,
}: {
  profileId: string;
  userId: string;
  initialProducts: any[];
  catalogLocked: boolean;
  maxProducts: number | null;
  initialCurrency: string;
  // Gates ProductRow's per-product "📣 Notify community" action.
  communityEnabled?: boolean;
}) {
  const supabase = createClient();
  const { t, locale } = useLanguage();
  // delete / reorder go through the section's auto-save engine (see useAutosavedRows). "Add" makes a
  // product on screen only; Save creates it once it has a name, and drops it if it stays empty.
  const { rows: products, update: updateProduct, remove: deleteProduct, reorder: handleReorder, addLocal, swapIn } = useAutosavedRows<any>("products", "products", initialProducts);
  const autosave = useAutosave();
  const [currency, setCurrency] = useState(initialCurrency || "USD");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  // Products whose stock is controlled from Inventory (Business Toolkit Phase 4). Their count is read-only here and is never sent by
  // the save below; the database ignores a browser write to it as well. Any failure (e.g. the table does not exist yet) = none are managed.
  const [stockManaged, setStockManaged] = useState<Set<string>>(new Set());
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { data, error } = await supabase.from("bk_stock_settings").select("product_id").eq("profile_id", profileId).eq("active", true);
        if (live && !error && data) setStockManaged(new Set(data.map((r: any) => r.product_id)));
      } catch {
        /* inventory not available: every count stays editable as before */
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);
  const pulse = useSavedPulse();
  const { draft, updateDraft } = useEditorPreview();
  // Reads off the live draft (not a prop from the server-rendered profile)
  // so picking a category in CategoryCard retitles this card immediately,
  // the same way every other field here updates live before it's saved.
  const title = getCategory(draft.category)?.defaults.catalogLabel?.[locale] || t.editor.catalog;

  const limitReached = maxProducts != null && products.length >= maxProducts;
  // Existing products past the plan's current limit are never removed here (still fully editable,
  // still reorderable) — this only surfaces that a real visitor won't currently see all of them.
  const hiddenCount = countHidden(products.length, maxProducts);

  // The currency is saved straight away; if that fails it goes back to what is really saved.
  const changeCurrency = async (code: string) => {
    const previous = currency;
    setCurrency(code);
    updateDraft({ currency: code });
    await autosave.run(() => supabase.from("profiles").update({ currency: code }).eq("id", profileId), {
      key: "currency",
      rollback: () => {
        setCurrency(previous);
        updateDraft({ currency: previous });
      },
    });
  };

  const addProduct = () => {
    if (catalogLocked || limitReached) return;
    const row = addLocal({
      name: "",
      price: null,
      description: "",
      image_url: null,
      image_urls: [],
      landing_url: null,
      whatsapp_message: null,
      available: true,
      inventory_count: null,
    } as any);
    setJustAddedId(row.id);
  };

  // The one explicit save for every product's fields at once — mirrors
  // WhatsAppCard: typing/uploading only updates local state (and the live
  // preview) above, nothing reaches Supabase until this is clicked. Adding,
  // deleting, and reordering products stay immediate since those are
  // structural actions, not field edits.
  const productPayload = (p: any) => ({
            name: typeof p.name === "string" ? p.name.trim() : p.name,
            price: p.price === "" || p.price == null ? null : p.price,
            description: p.description,
            image_url: p.image_url,
            image_urls: p.image_urls,
            landing_url: p.landing_url,
            whatsapp_message: p.whatsapp_message,
            available: p.available !== false,
            // A tracked product's count belongs to Inventory: it is left out of this save entirely.
            ...(stockManaged.has(p.id) ? {} : { inventory_count: p.inventory_count === "" || p.inventory_count == null ? null : Number(p.inventory_count) }),
            // Only sent when the row actually carries the cta columns, so a
            // save can never fail on a database that hasn't got them yet.
            ...(p.cta_preset !== undefined
              ? {
                  cta_preset: isCtaPresetId(p.cta_preset) ? p.cta_preset : null,
                  cta_label: normalizeCtaLabel(p.cta_label),
                }
              : {}),
            // Same backward-compatible guard, for Digital Products V1's new columns.
            ...(p.product_type !== undefined
              ? {
                  product_type: p.product_type === "digital" ? "digital" : "physical",
                  digital_file_path: p.product_type === "digital" ? p.digital_file_path || null : null,
                  digital_file_name: p.product_type === "digital" ? p.digital_file_name || null : null,
                  digital_file_size_bytes: p.product_type === "digital" ? p.digital_file_size_bytes ?? null : null,
                  digital_file_mime: p.product_type === "digital" ? p.digital_file_mime || null : null,
                }
              : {}),
  });

  const saveAll = async (): Promise<boolean> => {
    // Decide first: a product needs a name; empty rows added on screen are dropped, never saved.
    const plan = planProductsSave(products);
    const messages: Record<string, string> = {};
    for (const id of Object.keys(plan.errors)) messages[id] = t.editor.validation.nameRequired;
    setRowErrors(messages);
    if (Object.keys(messages).length > 0) return false;

    for (const id of plan.drop) void deleteProduct(id);
    const updates = await Promise.all(
      plan.updates.map(async (u) => ({ u, error: (await supabase.from("products").update(productPayload(u.row)).eq("id", u.row.id)).error }))
    );
    let failed = updates.some((x) => x.error);
    // Rows added on screen are created now; each is swapped for its real row the moment it exists, so a
    // retry after a partial failure cannot create it twice.
    for (const ins of plan.inserts) {
      const { data, error } = await supabase
        .from("products")
        .insert({ ...productPayload(ins.row), profile_id: profileId, sort_order: ins.position })
        .select()
        .single();
      if (error || !data) {
        failed = true;
        continue;
      }
      swapIn(ins.row.id, { ...ins.row, ...data });
    }
    // A failed write used to be swallowed and still show "Saved".
    if (failed) return false;
    pulse.show();
    return true;
  };
  const inSection = useSectionSave(saveAll);

  if (catalogLocked) {
    return (
      <EditorCard icon={ShoppingBag} title={title}>
        <div className="border border-dashed border-ringo-border rounded-card p-6 text-center text-sm text-ringo-muted flex flex-col items-center gap-3">
          {t.editor.catalogLocked}
          <PlanCta variant="secondary">{t.sidebar.upgradePlan}</PlanCta>
        </div>
      </EditorCard>
    );
  }

  return (
    <EditorCard
      icon={ShoppingBag}
      title={title}
      action={
        <>
          <SavedPulse visible={pulse.visible} label={t.editor.saved} />
          <CurrencySelect value={currency} onChange={changeCurrency} />
          <button
            type="button"
            onClick={addProduct}
            disabled={limitReached}
            className="ringo-tactile ringo-cta inline-flex items-center text-xs font-semibold px-3.5 min-h-[44px] rounded-card whitespace-nowrap"
          >
            {t.editor.addProduct}
          </button>
        </>
      }
    >
      {hiddenCount > 0 && (
        <div className="mb-3 flex flex-col items-start gap-2">
          <p className="text-xs text-ringo-coral">{t.editor.productsHiddenByPlan(hiddenCount, maxProducts!)}</p>
          <PlanCta variant="secondary">{t.sidebar.upgradePlan}</PlanCta>
        </div>
      )}
      {products.length === 0 && <EmptyState icon={ShoppingBag} title={t.editor.noProductsYet} hint={t.editor.noProductsHint} />}

      <Reorder.Group axis="y" values={products} onReorder={handleReorder} className="flex flex-col gap-2">
        {products.map((product) => (
          <ProductRow
            key={product.id}
            product={product}
            stockManaged={stockManaged.has(product.id)}
            userId={userId}
            currency={currency}
            communityEnabled={communityEnabled}
            category={draft.category}
            isMusic={profileHasCategory(draft, "music_entertainment")}
            bookingEnabled={!!draft.bookings_enabled}
            restaurantOrdering={profileHasCategory(draft, "restaurant_food") && draft.ordering_enabled !== false}
            // Profile-level flag from the server + the same product rules the server applies (price, stock, availability).
            checkoutAvailable={!!draft.commerceCheckoutAvailable && checkProductEligibility({ product: { ...product, profile_id: product.profile_id ?? draft.id }, profileId: draft.id, quantity: 1 }) === null}
            isDemo={draft.is_demo === true}
            startExpanded={product.id === justAddedId}
            error={rowErrors[product.id]}
            onChange={(patch) => {
              if (rowErrors[product.id]) setRowErrors((prev) => ({ ...prev, [product.id]: "" }));
              updateProduct(product.id, patch);
            }}
            onDelete={() => deleteProduct(product.id)}
          />
        ))}
      </Reorder.Group>

      {products.length > 0 && !inSection && (
        <button
          type="button"
          onClick={saveAll}
          className="self-start mt-3 px-4 py-2 min-h-[44px] rounded-card bg-ringo-indigo text-white text-sm font-medium transition hover:brightness-110 active:scale-[0.97]"
        >
          {t.editor.save}
        </button>
      )}
    </EditorCard>
  );
}