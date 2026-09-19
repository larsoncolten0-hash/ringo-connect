"use client";

import { useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import AssociationPartnerView from "./AssociationPartnerView";

// A person can be an active Partner of more than one Association — a
// trivial side effect of the association_partners join-table design, not a
// real multi-Association feature. Per the product decision, this is
// deliberately just a plain pick-one list, not a persistent switcher.
export default function AssociationPickView({
  options,
  partnerProfileId,
}: {
  options: { associationProfileId: string; name: string; avatarUrl: string | null; demoCodeEntry?: boolean }[];
  partnerProfileId: string;
}) {
  const { t } = useLanguage();
  const [selected, setSelected] = useState<{ associationProfileId: string; name: string; demoCodeEntry?: boolean } | null>(null);

  if (selected) {
    return <AssociationPartnerView associationProfileId={selected.associationProfileId} associationName={selected.name} partnerProfileId={partnerProfileId} momoNumber={null} demoCodeEntry={!!selected.demoCodeEntry} />;
  }

  return (
    <div className="max-w-md flex flex-col gap-4">
      <h1 className="font-display text-lg font-semibold text-ringo-text">{t.association.pickAssociationTitle}</h1>
      <div className="flex flex-col gap-2.5">
        {options.map((o) => (
          <button
            key={o.associationProfileId}
            onClick={() => setSelected(o)}
            className="flex items-center gap-3 rounded-2xl border border-ringo-border/70 p-3.5 text-left hover:border-ringo-indigo transition"
          >
            <span className="w-9 h-9 rounded-full overflow-hidden flex items-center justify-center bg-ringo-indigo text-white text-xs font-medium shrink-0">
              {o.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={o.avatarUrl} alt={o.name} className="w-full h-full object-cover" />
              ) : (
                o.name?.[0]?.toUpperCase() || "?"
              )}
            </span>
            <span className="text-sm font-medium text-ringo-text">{o.name}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
