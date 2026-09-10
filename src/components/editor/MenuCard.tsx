"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "./EditorCard";
import EmptyState from "./EmptyState";
import MenuCategorySection from "./MenuCategorySection";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useEditorPreview } from "./EditorPreviewContext";

// Only ever rendered for a profile tagged Restaurant & Food. Two-level
// CRUD (categories, each holding items) — see the migration's comment on
// why there's no separate menu_item_options table yet.
export default function MenuCard({
  profileId,
  userId,
  initialCategories,
  initialItems,
  currency,
}: {
  profileId: string;
  userId: string;
  initialCategories: any[];
  initialItems: any[];
  currency: string;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [categories, setCategories] = useState(
    [...initialCategories].sort((a, b) => a.sort_order - b.sort_order)
  );
  const [items, setItems] = useState(initialItems);
  const [justAddedItemId, setJustAddedItemId] = useState<string | null>(null);
  const pulse = useSavedPulse();
  const { updateDraft } = useEditorPreview();

  const syncDraft = (nextCategories = categories, nextItems = items) => {
    updateDraft({ menu_categories: nextCategories, menu_items: nextItems });
  };

  const addCategory = async () => {
    const { data } = await supabase
      .from("menu_categories")
      .insert({ profile_id: profileId, name: "", sort_order: categories.length })
      .select()
      .single();
    if (data) {
      const next = [...categories, data];
      setCategories(next);
      syncDraft(next);
    }
  };

  const renameCategory = async (id: string, name: string) => {
    const next = categories.map((c) => (c.id === id ? { ...c, name } : c));
    setCategories(next);
    syncDraft(next);
    await supabase.from("menu_categories").update({ name }).eq("id", id);
  };

  const deleteCategory = async (id: string) => {
    const itemCount = items.filter((i) => i.menu_category_id === id).length;
    if (itemCount > 0 && !window.confirm(`Delete this category and its ${itemCount} item(s)?`)) return;

    const nextCategories = categories.filter((c) => c.id !== id);
    const nextItems = items.filter((i) => i.menu_category_id !== id);
    setCategories(nextCategories);
    setItems(nextItems);
    syncDraft(nextCategories, nextItems);
    await supabase.from("menu_categories").delete().eq("id", id);
  };

  const moveCategory = async (id: string, direction: "up" | "down") => {
    const idx = categories.findIndex((c) => c.id === id);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= categories.length) return;
    const next = [...categories];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    const reindexed = next.map((c, i) => ({ ...c, sort_order: i }));
    setCategories(reindexed);
    syncDraft(reindexed);
    await Promise.all(
      reindexed.map((c) => supabase.from("menu_categories").update({ sort_order: c.sort_order }).eq("id", c.id))
    );
  };

  const addItem = async (categoryId: string) => {
    const itemsInCategory = items.filter((i) => i.menu_category_id === categoryId);
    const { data } = await supabase
      .from("menu_items")
      .insert({
        profile_id: profileId,
        menu_category_id: categoryId,
        name: "",
        sort_order: itemsInCategory.length,
      })
      .select()
      .single();
    if (data) {
      const next = [...items, data];
      setItems(next);
      syncDraft(categories, next);
      setJustAddedItemId(data.id);
    }
  };

  const changeItem = (id: string, patch: any) => {
    const next = items.map((i) => (i.id === id ? { ...i, ...patch } : i));
    setItems(next);
    syncDraft(categories, next);
  };

  // One explicit save for every item's fields across every category —
  // mirrors WhatsAppCard: nothing reaches Supabase until this is clicked.
  // Adding/deleting/reordering items or categories stay immediate.
  const saveAllItems = async () => {
    await Promise.all(
      items.map((i) =>
        supabase
          .from("menu_items")
          .update({
            name: i.name,
            price: i.price === "" || i.price == null ? 0 : i.price,
            description: i.description,
            image_url: i.image_url,
            image_urls: i.image_urls,
            prep_time_minutes: i.prep_time_minutes === "" || i.prep_time_minutes == null ? null : Number(i.prep_time_minutes),
            available: i.available !== false,
            featured: !!i.featured,
          })
          .eq("id", i.id)
      )
    );
    pulse.show();
  };

  const deleteItem = async (id: string) => {
    const next = items.filter((i) => i.id !== id);
    setItems(next);
    syncDraft(categories, next);
    await supabase.from("menu_items").delete().eq("id", id);
  };

  const reorderItemsInCategory = (categoryId: string, newOrder: any[]) => {
    const reindexed = newOrder.map((it, i) => ({ ...it, sort_order: i }));
    const next = items.map((i) => {
      if (i.menu_category_id !== categoryId) return i;
      const updated = reindexed.find((r) => r.id === i.id);
      return updated || i;
    });
    setItems(next);
    syncDraft(categories, next);
    Promise.all(
      reindexed.map((it) => supabase.from("menu_items").update({ sort_order: it.sort_order }).eq("id", it.id))
    );
  };

  return (
    <EditorCard
      icon={BookOpen}
      title={t.restaurant.menuTitle}
      action={
        <>
          <SavedPulse visible={pulse.visible} label={t.editor.saved} />
          <button onClick={addCategory} className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white whitespace-nowrap">
            {t.restaurant.addCategory}
          </button>
        </>
      }
    >
      <p className="text-xs text-ringo-muted -mt-2 mb-3">{t.restaurant.menuHint}</p>

      {categories.length === 0 && <EmptyState icon={BookOpen} title={t.restaurant.noCategoriesYet} />}

      <div className="flex flex-col gap-3">
        {categories.map((category, idx) => {
          const categoryItems = items
            .filter((i) => i.menu_category_id === category.id)
            .sort((a, b) => a.sort_order - b.sort_order);
          return (
            <MenuCategorySection
              key={category.id}
              category={category}
              items={categoryItems}
              userId={userId}
              currency={currency}
              canMoveUp={idx > 0}
              canMoveDown={idx < categories.length - 1}
              justAddedItemId={justAddedItemId}
              onRenameCategory={(name) => renameCategory(category.id, name)}
              onDeleteCategory={() => deleteCategory(category.id)}
              onMoveCategory={(dir) => moveCategory(category.id, dir)}
              onAddItem={() => addItem(category.id)}
              onChangeItem={changeItem}
              onDeleteItem={deleteItem}
              onReorderItems={(newOrder) => reorderItemsInCategory(category.id, newOrder)}
            />
          );
        })}
      </div>

      {items.length > 0 && (
        <button
          onClick={saveAllItems}
          className="self-start mt-3 px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium"
        >
          {t.editor.save}
        </button>
      )}
    </EditorCard>
  );
}
