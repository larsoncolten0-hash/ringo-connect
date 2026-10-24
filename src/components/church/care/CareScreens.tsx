"use client";

import type { ChurchCapabilities } from "@/lib/church/permissions";
import LifecycleEditor from "../lifecycle/LifecycleEditor";
import LifecycleList from "../lifecycle/LifecycleList";
import CarePanel from "./CarePanel";
import { useCareConfig } from "./configs";

// The Care & Support screens: the shared lifecycle list and editor plugged into the care config, with the consent record and the private "who it is for" link under the editor. The church and the
// permissions are resolved on the server (the pages) and by /api/church/care/** on every request.
export function CareList({ caps }: { caps: ChurchCapabilities }) {
  return <LifecycleList config={useCareConfig()} caps={caps} />;
}
export function CareEditor({ id, caps }: { id?: string; caps: ChurchCapabilities }) {
  return <LifecycleEditor id={id} caps={caps} config={useCareConfig()} extra={(meta, _can, helpers) => <CarePanel caseId={meta.id} caps={caps} dirty={helpers.dirty} onChanged={helpers.reload} />} />;
}
