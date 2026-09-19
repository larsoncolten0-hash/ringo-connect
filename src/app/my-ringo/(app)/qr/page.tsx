import QRCode from "qrcode";
import { requireCustomer } from "@/lib/customer/server";
import { getCustomerQrPayload } from "@/lib/loyalty/qr";
import MyQrView from "@/components/my-ringo/loyalty/MyQrView";

export const dynamic = "force-dynamic";

// The customer's Ringo QR, drawn on the SERVER for the signed-in customer (requireCustomer). Only the
// finished picture (an SVG) reaches the browser: the code text is never sent to the client as text
// and there is no customer id in the page. If the QR secret is not configured the page shows a
// friendly "unavailable" state instead of an error.
export default async function MyRingoQrPage() {
  const customer = await requireCustomer();

  let svg: string | null = null;
  try {
    const payload = await getCustomerQrPayload(customer.id);
    svg = await QRCode.toString(payload, {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 1,
      color: { dark: "#1c1c28", light: "#ffffff" },
    });
  } catch (err) {
    console.error("my-ringo qr failed:", (err as any)?.message ?? "unknown error");
  }

  return <MyQrView svg={svg} />;
}
