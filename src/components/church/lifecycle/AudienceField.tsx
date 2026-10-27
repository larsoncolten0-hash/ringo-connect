"use client";

import { useEffect, useState } from "react";
import { useLanguage } from "@/components/LanguageProvider";
import { INPUT, churchApi } from "../people/shared";

interface GroupRow {
  id: string;
  kind: string;
}

// Who an announcement is for: the whole church (the default) or ONE public group (Men, Women, Youths, Children). The list of public groups comes from the server for the signed-in person's own
// church; with none set up, the only choice is the whole church. An announcement for a group shows on that group's page and not on the church-wide list.
export default function AudienceField({ id, value, onChange, disabled, labels }: { id: string; value: string; onChange: (id: string) => void; disabled?: boolean; labels: Record<string, string> }) {
  const { t } = useLanguage();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  useEffect(() => {
    let live = true;
    churchApi<{ items: GroupRow[] }>("/api/church/public-groups").then((r) => {
      if (live && r.ok && Array.isArray(r.body.items)) setGroups(r.body.items);
    });
    return () => {
      live = false;
    };
  }, []);
  const kinds = t.churchExpansion.groups.kinds as Record<string, string>;
  return (
    <select id={id} className={INPUT} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      <option value="">{labels.all ?? ""}</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {kinds[g.kind] ?? g.kind}
        </option>
      ))}
      {/* a group the list does not know (it was removed, or the person may not list groups) stays selectable so the value is not silently dropped */}
      {value !== "" && !groups.some((g) => g.id === value) && <option value={value}>{labels.group ?? ""}</option>}
    </select>
  );
}
