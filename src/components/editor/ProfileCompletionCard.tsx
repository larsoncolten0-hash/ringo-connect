"use client";

import { CheckCircle2, Circle, Sparkles } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { useEditorPreview } from "./EditorPreviewContext";
import { profileHasCategory } from "@/lib/categories";

// Facebook-style "complete your profile" widget — purely derived from the
// same live draft LivePreviewPanel already reads (see
// EditorPreviewContext), so the percentage/checklist update the instant a
// field changes, with no separate state or persistence of its own. Once
// every applicable item is met it renders nothing at all, so a fully
// filled-out profile never carries a permanent "100%" card around.
//
// Each unmet item links to its section via a plain <a> (not next/link) —
// a real hard navigation to `/dashboard?section=<id>`, which remounts the
// whole editor tree fresh so Accordion's existing `defaultOpenId` (read
// from that same query param in Editor.tsx) opens it, without needing any
// change to Accordion.tsx/EditorSection.tsx.
export default function ProfileCompletionCard() {
  const { t } = useLanguage();
  const { draft } = useEditorPreview();

  const isRestaurant = profileHasCategory(draft, "restaurant_food");
  const isMusic = profileHasCategory(draft, "music_entertainment");

  const hasContact =
    !!draft.whatsapp_number || (draft.social_links?.length ?? 0) > 0 || !!draft.about_email;
  const hasLinks = (draft.links?.length ?? 0) > 0;
  const hasCatalog = (draft.products?.length ?? 0) > 0;
  const hasMenu = (draft.menu_items?.length ?? 0) > 0;
  const hasTracks = (draft.tracks?.length ?? 0) > 0 || (draft.music_releases?.length ?? 0) > 0;

  const items: { id: string; label: string; met: boolean; section?: string }[] = [
    { id: "avatar", label: t.editor.completion.items.avatar, met: !!draft.avatar_url },
    { id: "bio", label: t.editor.completion.items.bio, met: !!draft.bio },
    { id: "category", label: t.editor.completion.items.category, met: !!draft.category, section: "category" },
    { id: "contact", label: t.editor.completion.items.contact, met: hasContact, section: "whatsapp" },
    { id: "links", label: t.editor.completion.items.links, met: hasLinks, section: "links" },
    { id: "catalog", label: t.editor.completion.items.catalog, met: hasCatalog, section: "catalog" },
  ];
  if (isRestaurant) items.push({ id: "menu", label: t.editor.completion.items.menu, met: hasMenu, section: "menu" });
  if (isMusic) items.push({ id: "tracks", label: t.editor.completion.items.tracks, met: hasTracks, section: "tracks" });

  const metCount = items.filter((i) => i.met).length;
  const pct = Math.round((metCount / items.length) * 100);

  if (pct >= 100) return null;

  return (
    <section className="animate-fade-up rounded-[20px] border border-ringo-border/60 bg-ringo-surface p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_24px_-18px_rgba(15,23,42,0.12)]">
      <div className="flex items-center gap-3 mb-4">
        <span className="w-8 h-8 rounded-xl bg-ringo-indigo/10 flex items-center justify-center shrink-0">
          <Sparkles size={15} className="text-ringo-indigo" strokeWidth={2.25} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold text-ringo-text tracking-[-0.01em]">{t.editor.completion.title}</h2>
          <p className="text-xs text-ringo-muted mt-0.5">{t.editor.completion.percentLabel(pct)}</p>
        </div>
      </div>

      <div className="h-1.5 w-full rounded-full bg-ringo-indigo/10 overflow-hidden mb-4">
        <div
          className="h-full rounded-full bg-ringo-indigo transition-[width] duration-500 ease-out"
          style={{ width: `${pct}%` }}
        />
      </div>

      <ul className="flex flex-col gap-2">
        {items.map((item) => {
          const row = (
            <>
              {item.met ? (
                <CheckCircle2 size={16} className="text-emerald-500 shrink-0" />
              ) : (
                <Circle size={16} className="text-ringo-muted/50 shrink-0" />
              )}
              <span className={`text-sm flex-1 min-w-0 ${item.met ? "text-ringo-muted line-through" : "text-ringo-text"}`}>
                {item.label}
              </span>
              {!item.met && item.section && (
                <span className="text-xs font-medium text-ringo-indigo shrink-0">{t.editor.completion.addCta}</span>
              )}
            </>
          );

          return (
            <li key={item.id}>
              {!item.met && item.section ? (
                <a
                  href={`/dashboard?section=${item.section}`}
                  className="flex items-center gap-2.5 py-1 -mx-1 px-1 rounded-lg hover:bg-ringo-muted/[0.04] transition-colors"
                >
                  {row}
                </a>
              ) : (
                <div className="flex items-center gap-2.5 py-1">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
