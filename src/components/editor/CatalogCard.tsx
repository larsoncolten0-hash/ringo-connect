"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Reorder } from "framer-motion";
import { ShoppingBag } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { getCategory } from "@/lib/categories";
import EditorCard from "./EditorCard";
import EmptyState from "./EmptyState";
import ProductRow from "./ProductRow";
import CurrencySelect from "./CurrencySelect";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useEditorPreview } from "./EditorPreviewContext";

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
  const [products, setProducts] = useState(
    [...initialProducts].sort((a, b) => a.sort_order - b.sort_order)
  );
  const [currency, setCurrency] = useState(initialCurrency || "USD");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout>>();
  const pulse = useSavedPulse();
  const { draft, updateDraft } = useEditorPreview();
  // Reads off the live draft (not a prop from the server-rendered profile)
  // so picking a category in CategoryCard retitles this card immediately,
  // the same way every other field here updates live before it's saved.
  const title = getCategory(draft.category)?.defaults.catalogLabel?.[locale] || t.editor.catalog;

  const limitReached = maxProducts != null && products.length >= maxProducts;

  const changeCurrency = async (code: string) => {
    setCurrency(code);
    updateDraft({ currency: code });
    await supabase.from("profiles").update({ currency: code }).eq("id", profileId);
  };

  const addProduct = async () => {
    if (catalogLocked || limitReached) return;
    const { data } = await supabase
      .from("products")
      .insert({ profile_id: profileId, name: "", sort_order: products.length })
      .select()
      .single();
    if (data) {
      const next = [...products, data];
      setProducts(next);
      updateDraft({ products: next });
      setJustAddedId(data.id);
    }
  };

  const updateProduct = (id: string, patch: any) => {
    setProducts((prev) => {
      const next = prev.map((p) => (p.id === id ? { ...p, ...patch } : p));
      updateDraft({ products: next });
      return next;
    });
  };

  // The one explicit save for every product's fields at once — mirrors
  // WhatsAppCard: typing/uploading only updates local state (and the live
  // preview) above, nothing reaches Supabase until this is clicked. Adding,
  // deleting, and reordering products stay immediate since those are
  // structural actions, not field edits.
  const saveAll = async () => {
    await Promise.all(
      products.map((p) =>
        supabase
          .from("products")
          .update({
            name: p.name,
            price: p.price === "" || p.price == null ? null : p.price,
            description: p.description,
            image_url: p.image_url,
            image_urls: p.image_urls,
            landing_url: p.landing_url,
            whatsapp_message: p.whatsapp_message,
            available: p.available !== false,
            inventory_count: p.inventory_count === "" || p.inventory_count == null ? null : Number(p.inventory_count),
          })
          .eq("id", p.id)
      )
    );
    pulse.show();
  };

  const deleteProduct = async (id: string) => {
    setProducts((prev) => {
      const next = prev.filter((p) => p.id !== id);
      updateDraft({ products: next });
      return next;
    });
    await supabase.from("products").delete().eq("id", id);
  };

  // sort_order is reindexed onto the items immediately (not just written
  // to Supabase after the debounce) — the live preview re-sorts by that
  // field the same way the real public page does.
  const handleReorder = (newOrder: any[]) => {
    const reindexed = newOrder.map((p, i) => ({ ...p, sort_order: i }));
    setProducts(reindexed);
    updateDraft({ products: reindexed });
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      Promise.all(reindexed.map((p) => supabase.from("products").update({ sort_order: p.sort_order }).eq("id", p.id)));
    }, 400);
  };

  if (catalogLocked) {
    return (
      <EditorCard icon={ShoppingBag} title={title}>
        <div className="border border-dashed border-ringo-border rounded-card p-6 text-center text-sm text-ringo-muted flex flex-col items-center gap-3">
          {t.editor.catalogLocked}
          <Link href="/dashboard/subscription" className="text-xs font-medium text-ringo-indigo">
            {t.sidebar.upgradePlan}
          </Link>
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
            onClick={addProduct}
            disabled={limitReached}
            className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white disabled:opacity-40 whitespace-nowrap transition hover:brightness-110 active:scale-[0.97]"
          >
            {t.editor.addProduct}
          </button>
        </>
      }
    >
      {products.length === 0 && <EmptyState icon={ShoppingBag} title={t.editor.noProductsYet} />}

      <Reorder.Group axis="y" values={products} onReorder={handleReorder} className="flex flex-col gap-2">
        {products.map((product) => (
          <ProductRow
            key={product.id}
            product={product}
            userId={userId}
            currency={currency}
            communityEnabled={communityEnabled}
            startExpanded={product.id === justAddedId}
            onChange={(patch) => updateProduct(product.id, patch)}
            onDelete={() => deleteProduct(product.id)}
          />
        ))}
      </Reorder.Group>

      {products.length > 0 && (
        <button
          onClick={saveAll}
          className="self-start mt-3 px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium transition hover:brightness-110 active:scale-[0.97]"
        >
          {t.editor.save}
        </button>
      )}
    </EditorCard>
  );
}