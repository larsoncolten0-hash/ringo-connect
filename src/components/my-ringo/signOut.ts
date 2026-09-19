import { clearAll } from "./player/offlineStore";

// Signs the customer out on THIS device: wipes saved-for-offline audio (it belongs
// to this customer's session, so a shared device keeps nothing behind), calls the
// existing /api/customer/logout route (revokes this session, clears the cookie),
// then does a full navigation so no cached My Ringo page survives.
export async function signOutCustomer() {
  try {
    // Capped at 3s so a stuck storage call can never block signing out.
    await Promise.race([clearAll().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3000))]);
    await fetch("/api/customer/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
  } finally {
    window.location.replace("/my-ringo/signin");
  }
}
