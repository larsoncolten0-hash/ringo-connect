import EventScannerView from "@/components/scanner/EventScannerView";

// Per-scanner PWA installability (manifest link, iOS home-screen name,
// theme color) + the page title/robots — see src/lib/scannerMetadata.ts.
export { generateMetadata, generateViewport } from "@/lib/scannerMetadata";

// The entire "Ringo Event Scanner" experience — completely separate from
// /dashboard on purpose (see the migration's own comment): security staff
// never see the artist's revenue, Music Store, sales analytics, or any
// other private Ringo information, because this route never reads any of
// it. All session resolution/validation happens in
// src/app/api/scanner/[token]/* using the admin client — this page itself
// does no data fetching at all, so it renders instantly and the actual
// camera can start the moment the browser grants permission, not after
// waiting on an unrelated server round trip.
export default function EventScannerPage({ params }: { params: { token: string } }) {
  return <EventScannerView token={params.token} />;
}
