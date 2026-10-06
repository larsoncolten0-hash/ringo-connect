"use client";

import { useState } from "react";
import NextLink from "next/link";
import { Reorder } from "framer-motion";
import { Link2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { normalizeLinkUrl } from "@/lib/linkUrl";
import { useLanguage } from "@/components/LanguageProvider";
import { useSectionSave } from "@/components/dashboard/sectionSave";
import EditorCard from "./EditorCard";
import EmptyState from "./EmptyState";
import LinkRow from "./LinkRow";
import SavedPulse, { useSavedPulse } from "./SavedPulse";
import { useAutosavedRows } from "./useAutosavedRows";
import { planLinksSave, type LinkRowLike } from "./linksSave";
import { countHidden } from "@/lib/planEntitlements";

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
  // delete / reorder go through the section's auto-save engine (see useAutosavedRows). "Add link" makes a
  // row on screen only; it is created in the database by Save, and only if it has a usable address.
  const { rows: links, update: updateLink, remove: deleteLink, reorder: handleReorder, addLocal, swapIn } = useAutosavedRows<any>("links", "links", initialLinks);
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const pulse = useSavedPulse();

  const limitReached = maxLinks != null && links.length >= maxLinks;
  // Existing links past the plan's current limit are never removed here (still fully editable,
  // still reorderable) — this only surfaces that a real visitor won't currently see all of them.
  const hiddenCount = countHidden(links.length, maxLinks);

  const addLink = () => {
    if (limitReached) return;
    const row = addLocal({ title: "", url: "", description: "", image_url: null } as any);
    setJustAddedId(row.id);
  };

  // One explicit save for every link at once — nothing reaches Supabase until this runs. It
  //   - creates the rows added with "Add link" that have a usable address, and quietly drops empty ones,
  //   - adds https:// to a bare address like example.com (the final address is shown back in the list),
  //   - refuses a link with no usable address, with the reason shown on that link.
  const saveAll = async (): Promise<boolean> => {
    const plan = planLinksSave(links as LinkRowLike[], (url) => normalizeLinkUrl(url));
    const messages: Record<string, string> = {};
    for (const [id, reason] of Object.entries(plan.errors)) {
      messages[id] = reason === "required" ? t.editor.validation.urlRequired : t.editor.validation.urlInvalid;
    }
    setRowErrors(messages);
    if (Object.keys(messages).length > 0) return false;

    let failed = false;
    for (const id of plan.drop) void deleteLink(id); // empty rows added on screen: nothing was ever saved for them
    // Updates for rows that already exist
    const updates = await Promise.all(
      plan.updates.map(async (u) => {
        const { error } = await supabase
          .from("links")
          .update({ title: u.row.title, url: u.payload.url, description: u.row.description, image_url: u.row.image_url })
          .eq("id", u.row.id);
        return { u, error };
      })
    );
    for (const { u, error } of updates) {
      if (error) failed = true;
      else if (u.payload.url !== u.row.url) updateLink(u.row.id, { url: u.payload.url }); // show the final address (https:// added)
    }
    // Inserts for rows added on screen; each one is swapped for its real row the moment it exists, so a
    // retry after a partial failure can never create it twice.
    for (const ins of plan.inserts) {
      const { data, error } = await supabase
        .from("links")
        .insert({
          profile_id: profileId,
          title: ins.row.title ?? "",
          url: ins.payload.url,
          description: ins.row.description ?? null,
          image_url: ins.row.image_url ?? null,
          sort_order: ins.position,
        })
        .select()
        .single();
      if (error || !data) {
        failed = true;
        continue;
      }
      swapIn(ins.row.id, data);
    }
    if (failed) return false;
    pulse.show();
    return true;
  };
  const inSection = useSectionSave(saveAll);

  return (
    <EditorCard
      icon={Link2}
      title={t.editor.links}
      action={
        <>
          <SavedPulse visible={pulse.visible} label={t.editor.saved} />
          {/* data-tour target for the onboarding tour's default-category
              step (src/lib/onboardingTour.ts) — plain attribute, additive only. */}
          <button
            type="button"
            data-tour="add-link"
            onClick={addLink}
            disabled={limitReached}
            className="ringo-tactile ringo-cta inline-flex items-center text-xs font-semibold px-3.5 min-h-[44px] rounded-card"
          >
            {t.editor.addLink}
          </button>
        </>
      }
    >
      {hiddenCount > 0 ? (
        <p className="text-xs text-ringo-coral mb-3">
          {t.editor.linksHiddenByPlan(hiddenCount, maxLinks!)}{" "}
          <NextLink href="/dashboard/subscription" className="font-medium underline">
            {t.sidebar.upgradePlan}
          </NextLink>
        </p>
      ) : (
        limitReached && (
          <p className="text-xs text-ringo-coral mb-3">
            {t.editor.linkLimitReached(maxLinks!)}{" "}
            <NextLink href="/dashboard/subscription" className="font-medium underline">
              {t.sidebar.upgradePlan}
            </NextLink>
          </p>
        )
      )}
      {links.length === 0 && (
        <div className="mb-2">
          <EmptyState icon={Link2} title={t.editor.noLinksYet} hint={t.editor.linksEmptyHint} />
        </div>
      )}

      <Reorder.Group axis="y" values={links} onReorder={handleReorder} className="flex flex-col gap-2">
        {links.map((link) => (
          <LinkRow
            key={link.id}
            link={link}
            userId={userId}
            startExpanded={link.id === justAddedId}
            error={rowErrors[link.id]}
            onChange={(patch) => {
              if (rowErrors[link.id]) setRowErrors((prev) => ({ ...prev, [link.id]: "" }));
              updateLink(link.id, patch);
            }}
            onDelete={() => deleteLink(link.id)}
          />
        ))}
      </Reorder.Group>

      {links.length > 0 && !inSection && (
        <button
          type="button"
          onClick={saveAll}
          className="ringo-tactile ringo-cta self-start mt-3 px-5 py-2 min-h-[44px] rounded-card text-sm font-semibold"
        >
          {t.editor.save}
        </button>
      )}
    </EditorCard>
  );
}
