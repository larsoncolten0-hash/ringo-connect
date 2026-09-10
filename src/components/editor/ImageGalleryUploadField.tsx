"use client";

import { useRef, useState } from "react";
import { Loader2, ImagePlus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

// Same upload path/bucket as ImageUploadField, but keeps up to `max`
// photos instead of one — used by ProductRow/MenuItemRow so a shop item,
// service, or menu item can carry a small photo gallery that customers
// scroll through on the public page (see ../ImageGallery.tsx).
export default function ImageGalleryUploadField({
  value,
  onChange,
  userId,
  folder,
  max = 3,
  size = 56,
  errorText,
}: {
  value?: (string | null)[] | null;
  onChange: (urls: string[]) => void;
  userId: string;
  folder: string; // e.g. "products", "menu-items"
  max?: number;
  size?: number;
  errorText?: { tooLarge: string; wrongType: string; failed: string };
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const urls = (value || []).filter((u): u is string => !!u);

  const handleFile = async (file: File) => {
    setError("");

    if (!file.type.startsWith("image/")) {
      setError(errorText?.wrongType || "Please choose an image file.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(errorText?.tooLarge || "Images must be under 5MB.");
      return;
    }

    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("uploads").upload(path, file, {
        upsert: true,
        cacheControl: "3600",
      });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("uploads").getPublicUrl(path);
      onChange([...urls, data.publicUrl].slice(0, max));
    } catch {
      setError(errorText?.failed || "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        {urls.map((url, i) => (
          <div
            key={url + i}
            style={{ width: size, height: size }}
            className="relative shrink-0 overflow-hidden rounded-card border border-ringo-border"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="" className="w-full h-full object-cover" />
            <button
              type="button"
              onClick={() => onChange(urls.filter((_, idx) => idx !== i))}
              className="absolute top-0.5 right-0.5 w-4 h-4 rounded-full bg-black/60 text-white flex items-center justify-center"
              aria-label="Remove photo"
            >
              <X size={10} />
            </button>
          </div>
        ))}

        {urls.length < max && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            style={{ width: size, height: size }}
            className="relative shrink-0 overflow-hidden rounded-card border border-dashed border-ringo-border flex items-center justify-center bg-ringo-muted/5 hover:border-ringo-indigo transition"
          >
            {uploading ? (
              <Loader2 size={16} className="animate-spin text-ringo-muted" />
            ) : (
              <ImagePlus size={18} className="text-ringo-muted" />
            )}
          </button>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
