"use client";

import { useEffect, useRef, useState } from "react";
import { Reorder } from "framer-motion";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import MenuItemRow from "./MenuItemRow";

export default function MenuCategorySection({
  category,
  items,
  userId,
  currency,
  canMoveUp,
  canMoveDown,
  justAddedItemId,
  justAdded,
  errors,
  onRenameCategory,
  onDeleteCategory,
  onMoveCategory,
  onAddItem,
  onChangeItem,
  onDeleteItem,
  onReorderItems,
}: {
  category: any;
  items: any[];
  userId: string;
  currency: string;
  canMoveUp: boolean;
  canMoveDown: boolean;
  justAddedItemId: string | null;
  /** This category was just created: select its default name so typing replaces it. */
  justAdded?: boolean;
  /** Per-dish reasons the last Save refused a dish, keyed by dish id. */
  errors?: Record<string, string>;
  onRenameCategory: (name: string) => void;
  onDeleteCategory: () => void;
  onMoveCategory: (direction: "up" | "down") => void;
  onAddItem: () => void;
  onChangeItem: (id: string, patch: any) => void;
  onDeleteItem: (id: string) => void;
  onReorderItems: (newOrder: any[]) => void;
}) {
  const { t } = useLanguage();
  const [name, setName] = useState(category.name);
  const [collapsed, setCollapsed] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (justAdded) nameRef.current?.select();
  }, [justAdded]);

  // A category must keep a name: leaving the field empty puts the previous name back instead of saving a blank one.
  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setName(category.name);
      return;
    }
    if (trimmed !== category.name) onRenameCategory(trimmed);
  };

  const iconBtn =
    "shrink-0 w-11 h-11 flex items-center justify-center rounded-lg text-ringo-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50";

  return (
    <div className="border border-ringo-border rounded-card overflow-hidden">
      <div className="flex items-center gap-0.5 p-1.5 bg-ringo-muted/5">
        <div className="flex shrink-0">
          <button
            type="button"
            onClick={() => onMoveCategory("up")}
            disabled={!canMoveUp}
            aria-label={t.restaurant.moveCategoryUp}
            className={`${iconBtn} w-9 disabled:opacity-30`}
          >
            <ChevronUp size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onMoveCategory("down")}
            disabled={!canMoveDown}
            aria-label={t.restaurant.moveCategoryDown}
            className={`${iconBtn} w-9 disabled:opacity-30`}
          >
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        </div>
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          placeholder={t.restaurant.categoryNamePlaceholder}
          aria-label={t.restaurant.categoryNamePlaceholder}
          className="flex-1 min-w-0 min-h-[44px] text-sm font-medium bg-transparent text-ringo-text px-1.5 py-1"
        />
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className={iconBtn}
          aria-label={t.restaurant.toggleCategory}
          aria-expanded={!collapsed}
        >
          <ChevronDown size={15} aria-hidden="true" className={`transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
        <button type="button" onClick={onDeleteCategory} aria-label={t.restaurant.deleteCategory} className={`${iconBtn} hover:text-red-500`}>
          <X size={15} aria-hidden="true" />
        </button>
      </div>

      {!collapsed && (
        <div className="p-2.5 flex flex-col gap-2">
          {items.length === 0 && <p className="text-xs text-ringo-muted px-1">{t.restaurant.noItemsYet}</p>}

          <Reorder.Group axis="y" values={items} onReorder={onReorderItems} className="flex flex-col gap-2">
            {items.map((item) => (
              <MenuItemRow
                key={item.id}
                item={item}
                userId={userId}
                currency={currency}
                startExpanded={item.id === justAddedItemId}
                error={errors?.[item.id]}
                onChange={(patch) => onChangeItem(item.id, patch)}
                onDelete={() => onDeleteItem(item.id)}
              />
            ))}
          </Reorder.Group>

          {/* data-tour target for the onboarding tour's Restaurant-branch
              step (src/lib/onboardingTour.ts) — plain attribute, additive only. */}
          <button
            type="button"
            data-tour="add-menu-item"
            onClick={onAddItem}
            className="self-start min-h-[44px] text-xs font-medium text-ringo-indigo px-2 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/50"
          >
            {t.restaurant.addItem}
          </button>
        </div>
      )}
    </div>
  );
}
