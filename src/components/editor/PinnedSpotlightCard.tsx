"use client";

import { useState } from "react";
import { Pin, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "./EditorCard";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useEditorPreview } from "./EditorPreviewContext";

type PinType = "track" | "product" | "event";

// Only ever rendered for a profile tagged Music & Entertainment. Replaces
// the earlier "Artist Hub" nav — instead of a grid of shortcuts, the
// creator picks ONE item (from whatever tracks/merch/events already exist
// on their page) to feature at the very top, as a real visual hero card
// (see PinnedSpotlight on the public page).
export default function PinnedSpotlightCard({
  profileId,
  initialPinnedType,
  initialPinnedId,
}: {
  profileId: string;
  initialPinnedType: string | null;
  initialPinnedId: string | null;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [pinnedType, setPinnedType] = useState<PinType | null>((initialPinnedType as PinType) || null);
  const [pinnedId, setPinnedId] = useState<string | null>(initialPinnedId);
  const pulse = useSavedPulse();
  const { draft, updateDraft } = useEditorPreview();

  // Reads off the live draft, not a static prop, so an item added to
  // Tracks/Catalog/Events moments ago is immediately pinnable without a
  // page reload.
  const itemsByType: Record<PinType, any[]> = {
    track: draft.tracks || [],
    product: draft.products || [],
    event: draft.events || [],
  };

  const typeLabel: Record<PinType, string> = {
    track: t.music.pinnedTypeTrack,
    product: t.music.pinnedTypeProduct,
    event: t.music.pinnedTypeEvent,
  };

  const itemTitle = (type: PinType, item: any) => (type === "product" ? item.name : item.title) || "…";

  const persist = async (type: PinType | null, id: string | null) => {
    await supabase.from("profiles").update({ pinned_type: type, pinned_id: id }).eq("id", profileId);
    updateDraft({ pinned_type: type, pinned_id: id });
    pulse.show();
  };

  const selectType = (type: PinType) => {
    // Switching type clears the item — the previous selection almost
    // certainly isn't a valid id for the new type.
    setPinnedType(type);
    setPinnedId(null);
  };

  const selectItem = (id: string) => {
    setPinnedId(id);
    if (pinnedType) persist(pinnedType, id);
  };

  const clearPin = () => {
    setPinnedType(null);
    setPinnedId(null);
    persist(null, null);
  };

  return (
    <EditorCard
      icon={Pin}
      title={t.music.pinnedTitle}
      action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}
    >
      <p className="text-xs text-ringo-muted -mt-1 mb-4">{t.music.pinnedHint}</p>

      <div className="flex flex-col gap-3">
        <div className="flex gap-1.5">
          {(["track", "product", "event"] as PinType[]).map((type) => (
            <button
              key={type}
              onClick={() => selectType(type)}
              className={`text-xs font-medium px-3 py-1.5 rounded-full border transition ${
                pinnedType === type
                  ? "border-ringo-indigo bg-ringo-indigo/10 text-ringo-indigo"
                  : "border-ringo-border text-ringo-muted"
              }`}
            >
              {typeLabel[type]}
            </button>
          ))}
        </div>

        {pinnedType &&
          (itemsByType[pinnedType].length === 0 ? (
            <p className="text-xs text-ringo-muted">{t.music.pinnedNoneAvailable}</p>
          ) : (
            <div className="flex items-center gap-2">
              <select
                value={pinnedId || ""}
                onChange={(e) => selectItem(e.target.value)}
                className="flex-1 min-w-0 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-surface text-ringo-text"
              >
                <option value="" disabled>
                  {t.music.pinnedItemPlaceholder}
                </option>
                {itemsByType[pinnedType].map((item: any) => (
                  <option key={item.id} value={item.id}>
                    {itemTitle(pinnedType, item)}
                  </option>
                ))}
              </select>
              {pinnedId && (
                <button
                  onClick={clearPin}
                  className="shrink-0 flex items-center gap-1 text-xs font-medium text-ringo-muted hover:text-red-500 px-2 py-2"
                >
                  <X size={13} />
                  {t.music.pinnedClear}
                </button>
              )}
            </div>
          ))}
      </div>
    </EditorCard>
  );
}
