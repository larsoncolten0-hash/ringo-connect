import OptImg from "@/components/ui/OptImg";
import { safeChurchImageUrl } from "@/lib/church/images";

// An optional picture on a church card (event, announcement, care case). Drawn only when the address is one this platform stores (lib/church/images.ts), so a bad value is simply not shown. The picture is
// decorative (the text next to it says everything), so it has an empty alt. A fixed ratio keeps the card from jumping while it loads.
export default function ChurchPicture({ src, className = "", ratio = "16 / 9" }: { src?: string | null; className?: string; ratio?: string }) {
  const safe = safeChurchImageUrl(src);
  if (!safe) return null;
  return (
    <div className={`overflow-hidden bg-black/[0.04] ${className}`} style={{ aspectRatio: ratio }}>
      <OptImg src={safe} alt="" widths={[480, 768, 1280]} sizes="(min-width: 768px) 720px, 100vw" className="h-full w-full object-cover" />
    </div>
  );
}
