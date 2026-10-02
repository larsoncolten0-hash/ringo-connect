"use client";

import { useState } from "react";
import { BookOpen } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { useSectionSave } from "@/components/dashboard/sectionSave";
import EditorCard from "./EditorCard";
import EmptyState from "./EmptyState";
import MenuCategorySection from "./MenuCategorySection";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useAutosavedRows } from "./useAutosavedRows";
import { planMenuItemsSave } from "./menuSave";

// Only ever rendered for a profile tagged Restaurant & Food. Two-level
// CRUD (categories, each holding items) — see the migration's comment on
// why there's no separate menu_item_options table yet.
//
// Categories are structural: adding one creates it straight away, with a real default name (never a
// blank one), and renaming/reordering/deleting save on their own through the section's auto-save
// engine (failures are reported and rolled back or kept for a retry). Dishes are saved by "Save
// Changes": "Add item" makes a dish on screen only, and Save creates it once it has a name (an empty
// one is dropped), so no empty dish is ever stored.
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
  const categoriesApi = useAutosavedRows<any>("menu_categories", "menu_categories", initialCategories);
  const itemsApi = useAutosavedRows<any>("menu_items", "menu_items", initialItems);
  const categories = categoriesApi.rows;
  const items = itemsApi.rows;
  const [justAddedItemId, setJustAddedItemId] = useState<string | null>(null);
  const [justAddedCategoryId, setJustAddedCategoryId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const pulse = useSavedPulse();

  const addCategory = async () => {
    const created = await categoriesApi.add({ profile_id: profileId, name: t.restaurant.newCategoryName, sort_order: categories.length });
    if (created) setJustAddedCategoryId(created.id);
  };

  const renameCategory = async (id: string, name: string) => {
    categoriesApi.update(id, { name });
    await categoriesApi.persist(id, { name });
  };

  const deleteCategory = async (id: string) => {
    const owned = items.filter((i) => i.menu_category_id === id);
    if (owned.length > 0 && !window.confirm(t.restaurant.deleteCategoryConfirm(owned.length))) return;
    // its dishes go with it; if the delete fails both come back
    itemsApi.replace(items.filter((i) => i.menu_category_id !== id));
    const ok = await categoriesApi.remove(id);
    if (!ok) itemsApi.restoreRows(owned);
  };

  const moveCategory = (id: string, direction: "up" | "down") => {
    const idx = categories.findIndex((c) => c.id === id);
    const swapWith = direction === "up" ? idx - 1 : idx + 1;
    if (swapWith < 0 || swapWith >= categories.length) return;
    const next = [...categories];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    categoriesApi.reorder(next);
  };

  const addItem = (categoryId: string) => {
    const inCategory = items.filter((i) => i.menu_category_id === categoryId).length;
    const row = itemsApi.addLocal({
      menu_category_id: categoryId,
      name: "",
      price: "",
      description: "",
      image_url: null,
      image_urls: [],
      prep_time_minutes: null,
      available: true,
      featured: false,
      sort_order: inCategory,
    } as any);
    setJustAddedItemId(row.id);
  };

  const itemPayload = (i: any) => ({
    name: typeof i.name === "string" ? i.name.trim() : i.name,
    price: i.price === "" || i.price == null ? 0 : i.price,
    description: i.description,
    image_url: i.image_url,
    image_urls: i.image_urls,
    prep_time_minutes: i.prep_time_minutes === "" || i.prep_time_minutes == null ? null : Number(i.prep_time_minutes),
    available: i.available !== false,
    featured: !!i.featured,
  });

  // One explicit save for every dish across every category — nothing reaches Supabase until this runs.
  // A dish needs a name: empty dishes added on screen are dropped, never stored.
  const saveAllItems = async (): Promise<boolean> => {
    const plan = planMenuItemsSave(items);
    const messages: Record<string, string> = {};
    for (const id of Object.keys(plan.errors)) messages[id] = t.editor.validation.nameRequired;
    setRowErrors(messages);
    if (Object.keys(messages).length > 0) return false;

    for (const id of plan.drop) void itemsApi.remove(id);
    const updates = await Promise.all(
      plan.updates.map(async (u) => ({ error: (await supabase.from("menu_items").update(itemPayload(u.row)).eq("id", u.row.id)).error }))
    );
    let failed = updates.some((x) => x.error);
    for (const ins of plan.inserts) {
      const { data, error } = await supabase
        .from("menu_items")
        .insert({
          ...itemPayload(ins.row),
          profile_id: profileId,
          menu_category_id: ins.row.menu_category_id,
          sort_order: ins.row.sort_order ?? ins.position,
        })
        .select()
        .single();
      if (error || !data) {
        failed = true;
        continue;
      }
      itemsApi.swapIn(ins.row.id, { ...ins.row, ...data });
    }
    if (failed) return false;
    pulse.show();
    return true;
  };
  const inSection = useSectionSave(saveAllItems);

  return (
    <EditorCard
      icon={BookOpen}
      title={t.restaurant.menuTitle}
      action={
        <>
          <SavedPulse visible={pulse.visible} label={t.editor.saved} />
          <button type="button" onClick={addCategory} className="text-xs px-3 py-2.5 min-h-[44px] rounded-card bg-ringo-indigo text-white whitespace-nowrap transition hover:brightness-110 active:scale-[0.97]">
            {t.restaurant.addCategory}
          </button>
        </>
      }
    >
      <p className="text-xs text-ringo-muted -mt-2 mb-3">{t.restaurant.menuHint}</p>

      {categories.length === 0 && <EmptyState icon={BookOpen} title={t.restaurant.noCategoriesYet} hint={t.restaurant.menuEmptyHint} />}

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
              justAdded={category.id === justAddedCategoryId}
              errors={rowErrors}
              onRenameCategory={(name) => renameCategory(category.id, name)}
              onDeleteCategory={() => deleteCategory(category.id)}
              onMoveCategory={(dir) => moveCategory(category.id, dir)}
              onAddItem={() => addItem(category.id)}
              onChangeItem={(id, patch) => {
                if (rowErrors[id]) setRowErrors((prev) => ({ ...prev, [id]: "" }));
                itemsApi.update(id, patch);
              }}
              onDeleteItem={(id) => void itemsApi.remove(id)}
              onReorderItems={(newOrder) => itemsApi.reorder(newOrder, category.id)}
            />
          );
        })}
      </div>

      {items.length > 0 && !inSection && (
        <button
          type="button"
          onClick={saveAllItems}
          className="self-start mt-3 px-4 py-2 min-h-[44px] rounded-card bg-ringo-indigo text-white text-sm font-medium transition hover:brightness-110 active:scale-[0.97]"
        >
          {t.editor.save}
        </button>
      )}
    </EditorCard>
  );
}
