import RingoAiAdminView from "@/components/admin/RingoAiAdminView";

// Ringo AI controls. Access is enforced by src/app/admin/layout.tsx (admin
// role) and again by every /api/admin/ai/* route (assertAdmin).
// See src/app/admin/settings/page.tsx for why this is needed on every admin page.
export const dynamic = "force-dynamic";

export default function AdminRingoAiPage() {
  return <RingoAiAdminView />;
}
