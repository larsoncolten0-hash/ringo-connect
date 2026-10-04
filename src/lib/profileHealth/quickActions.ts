import type { ProfileHealth } from "./types";

// Which shortcuts Ringo Home offers. Only actions that exist for THIS profile are returned: an
// offering shortcut appears only when the matching criterion applies (category + plan allow it),
// so a free plan with a locked catalogue never sees "Add product or service".

export type QuickActionId = "edit" | "view" | "share" | "addCatalog" | "editMenu" | "addMusic" | "addEvent" | "analytics";

export interface QuickAction {
  id: QuickActionId;
  kind: "link" | "external" | "share";
  /** Internal route for "link"; unused for "external" (the caller knows the public URL) and "share". */
  href?: string;
}

export function quickActions(health: Pick<ProfileHealth, "items">): QuickAction[] {
  const has = (id: string) => health.items.some((i) => i.id === id);
  const out: QuickAction[] = [
    { id: "edit", kind: "link", href: "/dashboard" },
    { id: "view", kind: "external" },
    { id: "share", kind: "share" },
  ];
  if (has("menuItems")) out.push({ id: "editMenu", kind: "link", href: "/dashboard?section=menu" });
  if (has("tracks")) out.push({ id: "addMusic", kind: "link", href: "/dashboard?section=tracks" });
  if (has("events")) out.push({ id: "addEvent", kind: "link", href: "/dashboard/tickets" });
  if (has("catalog")) out.push({ id: "addCatalog", kind: "link", href: "/dashboard?section=catalog" });
  out.push({ id: "analytics", kind: "link", href: "/dashboard/analytics" });
  return out;
}
