// Shared QR-code drawing/download logic — used by the full QR code
// builder (src/components/dashboard/QrCodeGenerator.tsx) and the small
// auto-generated code shown right after approving a signup request (see
// QrCodeResult.tsx). Kept in one place so the "logo centered on the code"
// look and the download behavior never drift apart between the two.
import QRCode from "qrcode";

// Ringo Connect's own mark, drawn centered over the finished code. The QR
// is generated at error-correction level "H" (recovers ~30% of the
// symbol) specifically so this overlay — well under that budget — doesn't
// break scannability.
const LOGO_SRC = "/logo.png";

/**
 * Renders a QR code for `text` onto `canvas`, with the Ringo Connect logo
 * centered on a white rounded plate. Throws if the code or logo fails to
 * render — callers should catch and show an error state.
 */
export async function drawQrCodeWithLogo(canvas: HTMLCanvasElement, text: string, size: number) {
  await QRCode.toCanvas(canvas, text, {
    width: size,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#1c1c28ff", light: "#ffffffff" },
  });

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const logo = new Image();
  await new Promise<void>((resolve, reject) => {
    logo.onload = () => resolve();
    logo.onerror = () => reject(new Error("Logo failed to load"));
    logo.src = LOGO_SRC;
  });

  // Plate covers ~7% of the code's area (26% of a side) — well inside the
  // ~30% level-H can recover, so the logo never makes the code unscannable.
  const plate = size * 0.26;
  const plateX = (size - plate) / 2;
  const plateY = (size - plate) / 2;
  const r = plate * 0.18;

  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(plateX + r, plateY);
  ctx.arcTo(plateX + plate, plateY, plateX + plate, plateY + plate, r);
  ctx.arcTo(plateX + plate, plateY + plate, plateX, plateY + plate, r);
  ctx.arcTo(plateX, plateY + plate, plateX, plateY, r);
  ctx.arcTo(plateX, plateY, plateX + plate, plateY, r);
  ctx.closePath();
  ctx.fill();

  const logoSize = plate * 0.78;
  ctx.drawImage(logo, (size - logoSize) / 2, (size - logoSize) / 2, logoSize, logoSize);
}

/** Triggers a browser download of `canvas` as a PNG or JPEG file. */
export function downloadCanvas(canvas: HTMLCanvasElement, filename: string, format: "png" | "jpeg") {
  canvas.toBlob(
    (blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${filename}.${format === "jpeg" ? "jpg" : "png"}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    format === "png" ? "image/png" : "image/jpeg",
    0.95
  );
}
