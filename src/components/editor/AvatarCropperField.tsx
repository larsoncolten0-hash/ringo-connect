"use client";

import { useCallback, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Check, ImagePlus, Loader2, X, ZoomIn } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";

const MAX_SIZE_BYTES = 5 * 1024 * 1024;
// Exported at a fixed square size — plenty for the avatar itself and for
// /api/profile/avatar-icons' own PWA-icon derivatives, which already scale
// down from whatever avatar_url points at.
const OUTPUT_SIZE = 512;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

async function cropToBlob(src: string, area: Area): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_SIZE;
  canvas.height = OUTPUT_SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unavailable");
  ctx.drawImage(image, area.x, area.y, area.width, area.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("crop failed"))), "image/jpeg", 0.92);
  });
}

// Profile-picture upload with an interactive crop step in between: pick a
// photo, drag to reposition and pinch/scroll to zoom inside a circular
// preview (exactly how it'll appear everywhere avatar_url is used), then
// save. Reuses the same "uploads" bucket / ${userId}/avatar/ path
// ImageUploadField already uses for every other avatar upload — only the
// interaction in front of it is new.
export default function AvatarCropperField({
  value,
  onChange,
  userId,
  size = 64,
  errorText,
}: {
  value?: string | null;
  onChange: (url: string) => void;
  userId?: string;
  size?: number;
  errorText?: { tooLarge: string; wrongType: string; failed: string };
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rawSrc, setRawSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedArea, setCroppedArea] = useState<Area | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");

  const onCropComplete = useCallback((_percentArea: Area, pixelArea: Area) => setCroppedArea(pixelArea), []);

  const openCropper = (file: File) => {
    setError("");
    if (!file.type.startsWith("image/")) {
      setError(errorText?.wrongType || "Please choose an image file.");
      return;
    }
    if (file.size > MAX_SIZE_BYTES) {
      setError(errorText?.tooLarge || "Images must be under 5MB.");
      return;
    }
    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedArea(null);
    setRawSrc(URL.createObjectURL(file));
  };

  const closeCropper = () => {
    if (rawSrc) URL.revokeObjectURL(rawSrc);
    setRawSrc(null);
  };

  const save = async () => {
    if (!rawSrc || !croppedArea) return;
    setUploading(true);
    setError("");
    try {
      const blob = await cropToBlob(rawSrc, croppedArea);
      const path = `${userId}/avatar/${crypto.randomUUID()}.jpg`;
      const { error: uploadError } = await supabase.storage.from("uploads").upload(path, blob, {
        upsert: true,
        cacheControl: "3600",
        contentType: "image/jpeg",
      });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from("uploads").getPublicUrl(path);
      onChange(data.publicUrl);
      closeCropper();
    } catch {
      setError(errorText?.failed || "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const c = t.editor.avatarCropper;

  return (
    <>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          style={{ width: size, height: size }}
          className="relative shrink-0 overflow-hidden rounded-full border border-dashed border-ringo-border flex items-center justify-center bg-ringo-muted/5 hover:border-ringo-indigo transition"
        >
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="" className="w-full h-full object-cover" />
          ) : (
            <ImagePlus size={18} className="text-ringo-muted" />
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) openCropper(file);
            e.target.value = "";
          }}
        />
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {rawSrc && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-fade-in"
          onClick={(e) => {
            if (e.target === e.currentTarget && !uploading) closeCropper();
          }}
        >
          <div className="w-full max-w-sm bg-ringo-surface rounded-2xl overflow-hidden shadow-2xl flex flex-col animate-dropdown-in">
            <div className="flex items-center justify-between px-4 py-3 border-b border-ringo-border/70 shrink-0">
              <p className="text-sm font-semibold text-ringo-text">{c.title}</p>
              <button
                type="button"
                onClick={closeCropper}
                disabled={uploading}
                aria-label={c.cancel}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10 disabled:opacity-40"
              >
                <X size={15} />
              </button>
            </div>

            {/* touch-none: react-easy-crop owns pointer/touch gestures here
                (drag-to-reposition, pinch-to-zoom) — this just stops the
                page itself from scrolling underneath on mobile while the
                user is interacting with the crop area. */}
            <div className="relative w-full aspect-square bg-black touch-none">
              <Cropper
                image={rawSrc}
                crop={crop}
                zoom={zoom}
                minZoom={1}
                maxZoom={3}
                aspect={1}
                cropShape="round"
                showGrid={false}
                restrictPosition
                onCropChange={setCrop}
                onZoomChange={setZoom}
                onCropComplete={onCropComplete}
              />
            </div>

            <div className="px-4 pt-3 flex items-center gap-3 shrink-0">
              <ZoomIn size={15} className="text-ringo-muted shrink-0" />
              <input
                type="range"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="flex-1 accent-ringo-indigo"
                aria-label="Zoom"
              />
            </div>

            {error && <p className="px-4 pt-2 text-xs text-red-500">{error}</p>}

            <div className="p-4 flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={closeCropper}
                disabled={uploading}
                className="flex-1 text-sm font-medium px-3 py-2.5 rounded-xl border border-ringo-border text-ringo-muted hover:text-ringo-text transition disabled:opacity-50"
              >
                {c.cancel}
              </button>
              <button
                type="button"
                onClick={save}
                disabled={uploading || !croppedArea}
                className="flex-1 inline-flex items-center justify-center gap-1.5 text-sm font-semibold px-3 py-2.5 rounded-xl bg-gradient-to-r from-ringo-indigo to-fuchsia-500 text-white transition active:scale-[0.98] disabled:opacity-60"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                {uploading ? c.saving : c.save}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
