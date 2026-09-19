import { redirect } from "next/navigation";
import { getCustomerSession } from "@/lib/customer/server";
import SignInForm from "@/components/my-ringo/SignInForm";
import LanguageToggle from "@/components/LanguageToggle";

export const dynamic = "force-dynamic";

export default async function MyRingoSignInPage() {
  // Already signed in → straight to My Ringo.
  if (await getCustomerSession()) redirect("/my-ringo");

  return (
    <main className="relative flex min-h-screen items-center justify-center bg-ringo-bg px-4 py-10">
      <div className="absolute right-3 top-3" style={{ top: "max(0.75rem, env(safe-area-inset-top))" }}>
        <LanguageToggle />
      </div>
      <SignInForm />
    </main>
  );
}
