"use client";

import { useState } from "react";
import { MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useLanguage } from "@/components/LanguageProvider";
import EditorCard from "./EditorCard";
import SavedPulse, { useSavedPulse } from "./SavedPulse";

export default function WhatsAppCard({
  profileId,
  initialNumber,
  initialMessage,
}: {
  profileId: string;
  initialNumber: string | null;
  initialMessage: string | null;
}) {
  const supabase = createClient();
  const { t } = useLanguage();
  const [number, setNumber] = useState(initialNumber || "");
  const [message, setMessage] = useState(initialMessage || "");
  const pulse = useSavedPulse();

  const save = async () => {
    await supabase
      .from("profiles")
      .update({ whatsapp_number: number, default_whatsapp_message: message })
      .eq("id", profileId);
    pulse.show();
  };

  return (
    <EditorCard icon={MessageCircle} title={t.editor.whatsapp} action={<SavedPulse visible={pulse.visible} label={t.editor.saved} />}>
      <div className="flex flex-col gap-3">
        <div>
          <label className="text-xs text-ringo-muted mb-1 block">{t.editor.whatsappNumber}</label>
          <input
            value={number}
            onChange={(e) => setNumber(e.target.value)}
            placeholder="+1 555 123 4567"
            className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
        </div>
        <div>
          <label className="text-xs text-ringo-muted mb-1 block">{t.editor.whatsappDefaultMessage}</label>
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t.editor.whatsappMessagePlaceholder}
            className="w-full border border-ringo-border rounded-card px-3 py-2 text-sm bg-ringo-bg text-ringo-text"
          />
        </div>
        <button
          onClick={save}
          className="self-start px-4 py-2 rounded-card bg-ringo-indigo text-white text-sm font-medium"
        >
          {t.editor.save}
        </button>
      </div>
    </EditorCard>
  );
}