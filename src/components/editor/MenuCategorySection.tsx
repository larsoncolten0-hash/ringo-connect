"use client";

import { useState } from "react";
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

  return (
    <div className="border border-ringo-border rounded-card overflow-hidden">
      <div className="flex items-center gap-1.5 p-2.5 bg-ringo-muted/5">
        <div className="flex flex-col -gap-1 shrink-0">
          <button onClick={() => onMoveCategory("up")} disabled={!canMoveUp} className="text-ringo-muted disabled:opacity-30 -mb-1">
            <ChevronUp size={13} />
          </button>
          <button onClick={() => onMoveCategory("down")} disabled={!canMoveDown} className="text-ringo-muted disabled:opacity-30">
            <ChevronDown size={13} />
          </button>
        </div>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name !== category.name && onRenameCategory(name)}
          placeholder={t.restaurant.categoryNamePlaceholder}
          className="flex-1 min-w-0 text-sm font-medium bg-transparent text-ringo-text px-1.5 py-1"
        />
        <button
          onClick={() => setCollapsed((v) => !v)}
          className="shrink-0 text-ringo-muted p-1"
          aria-label="toggle"
        >
          <ChevronDown size={15} className={`transition-transform ${collapsed ? "" : "rotate-180"}`} />
        </button>
        <button onClick={onDeleteCategory} className="shrink-0 text-ringo-muted hover:text-red-500 p-1">
          <X size={15} />
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
                onChange={(patch) => onChangeItem(item.id, patch)}
                onDelete={() => onDeleteItem(item.id)}
              />
            ))}
          </Reorder.Group>

          <button onClick={onAddItem} className="self-start text-xs font-medium text-ringo-indigo px-1 py-1">
            {t.restaurant.addItem}
          </button>
        </div>
      )}
    </div>
  );
}
