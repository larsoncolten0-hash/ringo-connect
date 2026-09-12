"use client";

import { useState } from "react";
import { Tag } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import CategoryPicker from "@/components/CategoryPicker";
import { type CategoryId } from "@/lib/categories";
import EditorCard from "./EditorCard";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useEditorPreview } from "./EditorPreviewContext";

export default function CategoryCard({
  profileId,
  initialCategory,
  initialCategories,
}: {
  profileId: string;
  initialCategory: string | null;
  initialCategories: string[] | null;
}) {
  const supabase = createClient();
  const { t, locale } = useLanguage();
  const [category, setCategory] = useState<CategoryId | null>((initialCategory as CategoryId) || null);
  const [extraCategories, setExtraCategories] = useState<CategoryId[]>(
    ((initialCategories || []) as CategoryId[]).filter((id) => id !== initialCategory)
  );
  const pulse = useSavedPulse();
  const { updateDraft } = useEditorPreview();

  // Pushed into the live preview (and the catalog card's own title, which
  // reads category straight off the draft too) the moment a selection
  // changes — same as every other card here — independent of Save, which
  // only controls when it's actually persisted.
  const selectPrimary = (id: CategoryId) => {
    setCategory(id);
    updateDraft({ category: id, categories: [id, ...extraCategories] });
  };
  const toggleExtra = (id: CategoryId) => {
    setExtraCategories((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      if (category) updateDraft({ categories: [category, ...next] });
      return next;
    });
  };

  const save = async () => {
    if (!category) return;
    await supabase
      .from("profiles")
      .update({ category, categories: [category, ...extraCategories] })
      .eq("id", profileId);
    pulse.show();
  };

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
      <button
        onClick={save}
        disabled={!category}
        className="self-start mt-4 px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium disabled:opacity-40"
      >
        {t.editor.save}
      </button>
    </EditorCard>
  );
}
