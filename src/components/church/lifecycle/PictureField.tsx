"use client";

import { useLanguage } from "@/components/LanguageProvider";
import useCurrentUserId from "@/components/editor/useCurrentUserId";
import ImageUploadField from "@/components/editor/ImageUploadField";
import { safeChurchImageUrl } from "@/lib/church/images";

// The optional picture of an event, an announcement or a care case. It reuses the platform's own image uploader (the picture goes to this platform's storage, under the signed-in person's own folder), and
// shows the current picture with a clear way to remove it. The server accepts only an address in this platform's storage, so nothing else can be saved. Nothing is sent until the form is saved.
export default function PictureField({ value, onChange, disabled, labels }: { value: string; onChange: (url: string) => void; disabled?: boolean; labels: { choose: string; remove: string } }) {
  const { t } = useLanguage();
  const userId = useCurrentUserId();
  const current = safeChurchImageUrl(value) ? value : "";
  return (
    <div className="flex items-center gap-3">
      {disabled ? (
        current ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={current} alt="" className="h-24 w-24 rounded-2xl object-cover" />
        ) : null
      ) : (
        <ImageUploadField value={current || null} onChange={onChange} userId={userId} folder="church" optimizeFor="cover" shape="square" size={96} errorText={t.editor.upload} />
      )}
      <div className="flex min-w-0 flex-col items-start gap-1.5">
        {!current && !disabled && <span className="text-sm text-ringo-muted">{labels.choose}</span>}
        {current && !disabled && (
          <button type="button" onClick={() => onChange("")} className="inline-flex min-h-[44px] items-center rounded-full border border-ringo-border px-4 text-sm font-semibold text-ringo-text transition hover:border-ringo-indigo/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ringo-indigo/40">
            {labels.remove}
          </button>
        )}
      </div>
    </div>
  );
}
