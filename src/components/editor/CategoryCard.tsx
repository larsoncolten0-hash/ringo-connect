"use client";

import { useState } from "react";
import { Tag } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import { useSectionSave } from "@/components/dashboard/sectionSave";
import CategoryPicker from "@/components/CategoryPicker";
import { getCategory, isValidSubcategoryId, type CategoryId } from "@/lib/categories";
import EditorCard from "./EditorCard";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useEditorPreview } from "./EditorPreviewContext";

export default function CategoryCard({
  profileId,
  initialCategory,
  initialCategories,
  initialSubcategory,
}: {
  profileId: string;
  initialCategory: string | null;
  initialCategories: string[] | null;
  initialSubcategory?: string | null;
}) {
  const supabase = createClient();
  const { t, locale } = useLanguage();
  const [category, setCategory] = useState<CategoryId | null>((initialCategory as CategoryId) || null);
  const [extraCategories, setExtraCategories] = useState<CategoryId[]>(
    ((initialCategories || []) as CategoryId[]).filter((id) => id !== initialCategory)
  );
  const [subcategory, setSubcategory] = useState<string | null>(initialSubcategory || null);
  const pulse = useSavedPulse();
  const { updateDraft } = useEditorPreview();

  const subcategoryOptions = category ? getCategory(category)?.defaults.subcategories : undefined;

  // Pushed into the live preview (and the catalog card's own title, which
  // reads category straight off the draft too) the moment a selection
  // changes — same as every other card here — independent of Save, which
  // only controls when it's actually persisted.
  const selectPrimary = (id: CategoryId) => {
    setCategory(id);
    // A sub-category only ever makes sense against its own owning category
    // (see SubcategoryOption in categories.ts) — switching primary category
    // clears any sub-category that no longer belongs to the new one, so a
    // stale mismatched value can never be saved silently.
    const nextSubcategory = isValidSubcategoryId(id, subcategory) ? subcategory : null;
    setSubcategory(nextSubcategory);
    updateDraft({ category: id, categories: [id, ...extraCategories], subcategory: nextSubcategory });
  };
  const toggleExtra = (id: CategoryId) => {
    setExtraCategories((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      if (category) updateDraft({ categories: [category, ...next] });
      return next;
    });
  };
  const selectSubcategory = (id: string) => {
    const next = subcategory === id ? null : id;
    setSubcategory(next);
    updateDraft({ subcategory: next });
  };

  const save = async (): Promise<boolean> => {
    if (!category) return true; // nothing chosen yet, nothing to save
    const { error } = await supabase
      .from("profiles")
      .update({ category, categories: [category, ...extraCategories], subcategory })
      .eq("id", profileId);
    if (error) return false;
    pulse.show();
    return true;
  };
  const inSection = useSectionSave(save);

  return (
    <EditorCard icon={Tag} title={t.editor.category.title} action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}>
      <p className="text-xs text-ringo-muted -mt-1 mb-4">{t.editor.category.hint}</p>
      <CategoryPicker
        locale={locale}
        primary={category}
        onSelectPrimary={selectPrimary}
        extra={extraCategories}
        onToggleExtra={toggleExtra}
        strings={{ morePrompt: t.editor.category.morePrompt, moreHint: t.editor.category.moreHint }}
      />
      {!!subcategoryOptions?.length && (
        <div className="mt-4">
          <p className="text-xs font-medium text-ringo-text mb-1">{t.editor.category.subcategoryLabel}</p>
          <p className="text-xs text-ringo-muted mb-2">{t.editor.category.subcategoryHint}</p>
          <div className="flex flex-wrap gap-1.5">
            {subcategoryOptions.map((s) => (
              <button
                key={s.id}
                onClick={() => selectSubcategory(s.id)}
                className={`text-xs px-2.5 py-1.5 rounded-full border transition ${
                  subcategory === s.id
                    ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo font-medium"
                    : "border-ringo-border text-ringo-muted"
                }`}
              >
                {s.emoji} {s.label[locale]}
              </button>
            ))}
          </div>
        </div>
      )}
      {!inSection && (
        <button
          onClick={save}
          disabled={!category}
          className="self-start mt-4 px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-40"
        >
          {t.editor.save}
        </button>
      )}
    </EditorCard>
  );
}
