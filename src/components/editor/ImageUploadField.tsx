"use client";

import { useRef, useState } from "react";
import { Loader2, ImagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;

export default function ImageUploadField({
  value,
  onChange,
  userId,
  folder,
  pathPrefix,
  shape = "square",
  size = 64,
  errorText,
}: {
  value?: string | null;
  onChange: (url: string) => void;
  userId?: string;
  folder?: string; // e.g. "avatar", "links", "products"
  // Overrides the userId/folder-based path entirely — used for the
  // public signup-request form, where no account (and therefore no
  // userId) exists yet. Matches the "signup-requests" storage policy,
  // which is scoped separately from the per-user-id upload policy.
  pathPrefix?: string;
  shape?: "circle" | "square";
  size?: number;
  errorText?: { tooLarge: string; wrongType: string; failed: string };
}) {
  const supabase = createClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

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
      const path = pathPrefix
        ? `${pathPrefix}/${crypto.randomUUID()}.${ext}`
        : `${userId}/${folder}/${crypto.randomUUID()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("uploads").upload(path, file, {
        upsert: true,
        cacheControl: "3600",
      });
      if (uploadError) throw uploadError;

      const { data } = supabase.storage.from("uploads").getPublicUrl(path);
      onChange(data.publicUrl);
    } catch {
      setError(errorText?.failed || "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        style={{ width: size, height: size }}
        className={`relative shrink-0 overflow-hidden border border-dashed border-ringo-border flex items-center justify-center bg-ringo-muted/5 hover:border-ringo-indigo transition ${
          shape === "circle" ? "rounded-full" : "rounded-card"
        }`}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={value} alt="" className="w-full h-full object-cover" />
        ) : (
          <ImagePlus size={18} className="text-ringo-muted" />
        )}
        {uploading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <Loader2 size={16} className="animate-spin text-white" />
          </div>
        )}
      </button>
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
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}