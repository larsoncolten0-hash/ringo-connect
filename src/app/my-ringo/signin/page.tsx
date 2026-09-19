import { redirect } from "next/navigation";
import { getCustomerSession } from "@/lib/customer/server";
import SignInForm from "@/components/my-ringo/SignInForm";

export const dynamic = "force-dynamic";

export default async function MyRingoSignInPage() {
  // Already signed in → straight to My Ringo.
  if (await getCustomerSession()) redirect("/my-ringo");

  return (
    <main className="flex min-h-screen items-center justify-center bg-ringo-bg px-4 py-10">
      <SignInForm />
    </main>
  );
}
