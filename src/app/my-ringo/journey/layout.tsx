import JourneyShell from "@/components/church/bible/journey/JourneyShell";

export const dynamic = "force-dynamic";

// "My Bible Journey" (Churches & Ministries, Phase 5). A light frame OUTSIDE the My Ringo app shell: a visitor who is not signed in can still read a programme and is then asked to sign in to follow it.
// Every page below decides for itself what a signed-in visitor sees, and every action goes through /api/customer/bible/**, which knows the visitor only from their own session cookie.
export default function JourneyLayout({ children }: { children: React.ReactNode }) {
  return <JourneyShell>{children}</JourneyShell>;
}
