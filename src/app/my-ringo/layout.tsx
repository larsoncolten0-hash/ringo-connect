import type { Metadata } from "next";

// My Ringo is a private, per-customer space: never indexed. Each page under
// (app)/ authorizes itself through the customer session (requireCustomer);
// /my-ringo/signin is the only unguarded page.
export const metadata: Metadata = {
  title: "My Ringo",
  robots: { index: false, follow: false },
};

export default function MyRingoRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
