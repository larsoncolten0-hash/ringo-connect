"use client";

import { useState, useRef } from "react";
import { Reorder } from "framer-motion";
import { ShoppingBag } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "./EditorCard";
import ProductRow from "./ProductRow";
import CurrencySelect from "./CurrencySelect";

export default function CatalogCard({
  profileId,
  userId,
  initialProducts,
  catalogLocked,
  maxProducts,
  initialCurrency,
}: {
  profileId: string;
  userId: string;
  initialProducts: any[];
  catalogLocked: boolean;
  maxProducts: number | null;
  initialCurrency: string;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [products, setProducts] = useState(
    [...initialProducts].sort((a, b) => a.sort_order - b.sort_order)
  );
  const [currency, setCurrency] = useState(initialCurrency || "USD");
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout>>();

  const limitReached = maxProducts != null && products.length >= maxProducts;

  const changeCurrency = async (code: string) => {
    setCurrency(code);
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
      setProducts([...products, data]);
      setJustAddedId(data.id);
    }
  };

  const updateProduct = (id: string, patch: any) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  };

  const persistProduct = async (id: string, patch: any) => {
    await supabase.from("products").update(patch).eq("id", id);
  };

  const deleteProduct = async (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
    await supabase.from("products").delete().eq("id", id);
  };

  const handleReorder = (newOrder: any[]) => {
    setProducts(newOrder);
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      Promise.all(newOrder.map((p, i) => supabase.from("products").update({ sort_order: i }).eq("id", p.id)));
    }, 400);
  };

  if (catalogLocked) {
    return (
      <EditorCard icon={ShoppingBag} title={t.editor.catalog}>
        <div className="border border-dashed border-ringo-border rounded-card p-6 text-center text-sm text-ringo-muted">
          {t.editor.catalogLocked}
        </div>
      </EditorCard>
    );
  }

  return (
    <EditorCard
      icon={ShoppingBag}
      title={t.editor.catalog}
      action={
        <>
          <CurrencySelect value={currency} onChange={changeCurrency} />
          <button
            onClick={addProduct}
            disabled={limitReached}
            className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white disabled:opacity-40 whitespace-nowrap"
          >
            {t.editor.addProduct}
          </button>
        </>
      }
    >
      {products.length === 0 && <p className="text-sm text-ringo-muted">{t.editor.noProductsYet}</p>}

      <Reorder.Group axis="y" values={products} onReorder={handleReorder} className="flex flex-col gap-2">
        {products.map((product) => (
          <ProductRow
            key={product.id}
            product={product}
            userId={userId}
            currency={currency}
            startExpanded={product.id === justAddedId}
            onChange={(patch) => updateProduct(product.id, patch)}
            onPersist={(patch) => persistProduct(product.id, patch)}
            onDelete={() => deleteProduct(product.id)}
          />
        ))}
      </Reorder.Group>
    </EditorCard>
  );
}