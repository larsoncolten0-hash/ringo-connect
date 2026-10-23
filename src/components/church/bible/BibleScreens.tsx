"use client";

import type { ChurchCapabilities } from "@/lib/church/permissions";
import LifecycleEditor from "../lifecycle/LifecycleEditor";
import LifecycleList from "../lifecycle/LifecycleList";
import { useProgramsConfig } from "./configs";
import SessionsPanel from "./SessionsPanel";

// The Bible programme screens (Phase 5, church side): the shared lifecycle list and editor, plus the days and the participant COUNTS under the editor once the programme is saved. The church and the
// permissions are resolved on the server (the pages) and by /api/church/** on every request.
export function ProgramsList({ caps }: { caps: ChurchCapabilities }) {
  return <LifecycleList config={useProgramsConfig()} caps={caps} />;
}
export function ProgramEditor({ id, caps }: { id?: string; caps: ChurchCapabilities }) {
  return (
    <LifecycleEditor
      id={id}
      caps={caps}
      config={useProgramsConfig()}
      // keyed by the programme's version and status: publishing, unpublishing or saving reloads the days and the rights
      extra={(meta) => <SessionsPanel key={`${meta.id}:${meta.status}:${meta.updated_at}`} programId={meta.id} live={meta.status === "published"} caps={caps} />}
    />
  );
}
