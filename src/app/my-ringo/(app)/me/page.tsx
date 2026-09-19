import { requireCustomer } from "@/lib/customer/server";
import { MeView } from "@/components/my-ringo/MyRingoViews";

export const dynamic = "force-dynamic";

export default async function MyRingoMePage() {
  const customer = await requireCustomer();
  return (
    <MeView
      customer={{
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        avatarUrl: customer.avatar_url,
        preferredLanguage: customer.preferred_language,
        emailConfirmed: !!customer.email_verified_at,
      }}
    />
  );
}
