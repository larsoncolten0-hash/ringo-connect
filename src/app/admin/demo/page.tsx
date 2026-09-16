import AdminDemoLinkCard from "@/components/admin/AdminDemoLinkCard";

// See src/app/admin/qr-code/page.tsx for the identical "small utility page
// for sharing a link" precedent this mirrors.
export const dynamic = "force-dynamic";

export default function AdminDemoPage() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://ringoconnectltd.com";
  return <AdminDemoLinkCard demoUrl={`${siteUrl}/demo`} />;
}
