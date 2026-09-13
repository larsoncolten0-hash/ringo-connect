import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import AdminShell from "@/components/admin/AdminShell";

// Per-admin PWA installability (manifest link, iOS home-screen name/icon,
// theme color) for the whole /admin/** tree — see src/lib/adminMetadata.ts.
export { generateMetadata, generateViewport } from "@/lib/adminMetadata";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { data: userRow } = await supabase
    .from("users")
    .select("role, email")
    .eq("id", user.id)
    .single();

  // Server-side role check - this is the real gate. RLS backs it up at the data layer.
  if (userRow?.role !== "admin") redirect("/dashboard");

  return <AdminShell email={userRow.email ?? user.email ?? ""}>{children}</AdminShell>;
}