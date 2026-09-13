import BroadcastComposer from "@/components/admin/BroadcastComposer";

// No extra gate needed — every /admin/* route is already restricted to
// role === "admin" by admin/layout.tsx (the actual send also re-checks
// via assertAdmin() in /api/admin/broadcast, since a layout is never a
// security boundary on its own).
export default function AdminBroadcastPage() {
  return <BroadcastComposer />;
}
