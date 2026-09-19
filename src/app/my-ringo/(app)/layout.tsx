import { requireCustomer } from "@/lib/customer/server";
import MyRingoShell from "@/components/my-ringo/MyRingoShell";

export const dynamic = "force-dynamic";

// The customer shell. Session-guarded, but note every page below ALSO calls
// requireCustomer() — layouts aren't re-run on client-side navigation, so a
// layout guard alone is not authorization. Only the display name and avatar
// reach the client shell (no email, phone or id).
export default async function MyRingoAppLayout({ children }: { children: React.ReactNode }) {
  const customer = await requireCustomer();
  return <MyRingoShell customer={{ name: customer.name, avatarUrl: customer.avatar_url }}>{children}</MyRingoShell>;
}
