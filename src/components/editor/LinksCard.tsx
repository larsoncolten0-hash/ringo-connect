"use client";

import { useState, useRef } from "react";
import NextLink from "next/link";
import { Reorder } from "framer-motion";
import { Link2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "./EditorCard";
import EmptyState from "./EmptyState";
import LinkRow from "./LinkRow";
import { useEditorPreview } from "./EditorPreviewContext";

export default function LinksCard({
  profileId,
  userId,
  initialLinks,
  maxLinks,
}: {
  profileId: string;
  userId: string;
  initialLinks: any[];
  maxLinks: number | null;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [links, setLinks] = useState(
    [...initialLinks].sort((a, b) => a.sort_order - b.sort_order)
  );
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout>>();
  const { updateDraft } = useEditorPreview();

  const limitReached = maxLinks != null && links.length >= maxLinks;

  const addLink = async () => {
    if (limitReached) return;
    const { data } = await supabase
      .from("links")
      .insert({ profile_id: profileId, title: "", url: "https://", sort_order: links.length })
      .select()
      .single();
    if (data) {
      const next = [...links, data];
      setLinks(next);
      updateDraft({ links: next });
      setJustAddedId(data.id);
    }
  };

  const updateLink = (id: string, patch: any) => {
    setLinks((prev) => {
      const next = prev.map((l) => (l.id === id ? { ...l, ...patch } : l));
      updateDraft({ links: next });
      return next;
    });
  };

  const persistLink = async (id: string, patch: any) => {
    await supabase.from("links").update(patch).eq("id", id);
  };

  const deleteLink = async (id: string) => {
    setLinks((prev) => {
      const next = prev.filter((l) => l.id !== id);
      updateDraft({ links: next });
      return next;
    });
    await supabase.from("links").delete().eq("id", id);
  };

  // Reorder fires continuously while dragging — debounce the DB writes so
  // we're not hammering Supabase on every pixel of movement, while state
  // (and therefore the visual order) updates instantly. sort_order is
  // stamped onto the in-memory items immediately too (not just written to
  // Supabase later) — the live preview re-sorts by that field the same
  // way the real public page does, so without this the drag would look
  // like it snaps back until the debounced write actually lands.
  const handleReorder = (newOrder: any[]) => {
    const reindexed = newOrder.map((link, i) => ({ ...link, sort_order: i }));
    setLinks(reindexed);
    updateDraft({ links: reindexed });
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      Promise.all(reindexed.map((link) => supabase.from("links").update({ sort_order: link.sort_order }).eq("id", link.id)));
    }, 400);
  };

  return (
    <EditorCard
      icon={Link2}
      title={t.editor.links}
      action={
        <button
          onClick={addLink}
          disabled={limitReached}
          className="text-xs px-3 py-1.5 rounded-card bg-ringo-indigo text-white disabled:opacity-40"
        >
          {t.editor.addLink}
        </button>
      }
    >
      {limitReached && (
        <p className="text-xs text-ringo-coral mb-3">
          {t.editor.linkLimitReached(maxLinks!)}{" "}
          <NextLink href="/dashboard/subscription" className="font-medium underline">
            {t.sidebar.upgradePlan}
          </NextLink>
        </p>
      )}
      {links.length === 0 && (
        <div className="mb-2">
          <EmptyState icon={Link2} title={t.editor.noLinksYet} />
        </div>
      )}

      <Reorder.Group axis="y" values={links} onReorder={handleReorder} className="flex flex-col gap-2">
        {links.map((link) => (
          <LinkRow
            key={link.id}
            link={link}
            userId={userId}
            startExpanded={link.id === justAddedId}
            onChange={(patch) => updateLink(link.id, patch)}
            onPersist={(patch) => persistLink(link.id, patch)}
            onDelete={() => deleteLink(link.id)}
          />
        ))}
      </Reorder.Group>
    </EditorCard>
  );
}