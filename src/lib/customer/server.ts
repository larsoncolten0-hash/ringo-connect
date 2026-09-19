import { cache } from "react";
import { redirect } from "next/navigation";
import { getCustomerFromCookie } from "@/lib/customer/session";

// Server-component access to the signed-in Ringo CUSTOMER (never the
// creator/admin Supabase session). `cache()` dedupes the lookup within one
// request, so a layout and its page can both call requireCustomer() without
// hitting the database twice.
//
// EVERY My Ringo page must call requireCustomer() itself — a layout's guard
// is not enough on its own, because layouts are not re-run on client-side
// navigation between sibling pages.
export const getCustomerSession = cache(getCustomerFromCookie);

export async function requireCustomer() {
  const session = await getCustomerSession();
  // No/expired session → the CUSTOMER sign-in page, never creator/admin login.
  if (!session) redirect("/my-ringo/signin");
  return session.customer;
}
