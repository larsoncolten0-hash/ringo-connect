"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLanguage } from "@/components/LanguageProvider";
import { MAX_REPLY_LENGTH, interpretReply, newRequestId, postReply, type ErrorKey } from "@/lib/inbox/client";

// Human text reply (WhatsApp). Text only, intentionally plain:
//   * Enter inserts a new line (what people expect on a phone); Ctrl/Cmd + Enter, or the Send button, sends. Nothing is sent by an accidental keypress.
//   * one user action = one client_request_id. It is kept across a retry whose outcome is unknown (network error / server error), so pressing
//     Send again can never create a second customer message; it is replaced only after a definite answer.
//   * the box and the button are locked while a send is in flight, so a double click cannot send twice.
//   * the browser only calls Ringo's own route; the recipient is decided by the conversation, never typed here.

export default function ReplyComposer({ conversationId, open }: { conversationId: string; open: boolean }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const requestId = useRef<string | null>(null);
  const requestText = useRef("");
  const inFlight = useRef(false);

  async function submit() {
    if (inFlight.current) return;
    const trimmed = text.trim();
    if (trimmed === "") return setError("emptyMessage");
    if (Array.from(trimmed).length > MAX_REPLY_LENGTH) return setError("messageTooLong");
    inFlight.current = true;
    setSending(true);
    setError(null);
    if (!requestId.current) requestId.current = newRequestId();
    requestText.current = trimmed;
    const result = await postReply(conversationId, trimmed, requestId.current);
    const effect = interpretReply(result);
    inFlight.current = false;
    setSending(false);
    if (!effect.keepRequestId) requestId.current = null;
    if (effect.clearText) setText("");
    setError(effect.error);
    if (effect.refresh) router.refresh();
  }

  if (!open) {
    return <p className="border-t border-ringo-border px-4 py-3 text-xs text-ringo-muted">{u.windowClosed}</p>;
  }

  const id = `reply-${conversationId}`;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="border-t border-ringo-border p-3"
    >
      <label htmlFor={id} className="sr-only">{u.reply}</label>
      <textarea
        id={id}
        value={text}
        rows={2}
        maxLength={MAX_REPLY_LENGTH}
        readOnly={sending}
        placeholder={u.replyPlaceholder}
        aria-describedby={`${id}-hint`}
        aria-invalid={error === "emptyMessage" || error === "messageTooLong" ? true : undefined}
        onChange={(e) => {
          setText(e.target.value);
          // Editing the text after an unknown outcome makes it a different message: it must not reuse the old request id.
          if (requestId.current && e.target.value.trim() !== requestText.current) requestId.current = null;
          if (error === "emptyMessage" || error === "messageTooLong") setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
        }}
        className="block max-h-40 min-h-[44px] w-full resize-y rounded-card border border-ringo-border bg-transparent px-3 py-2 text-sm text-ringo-text placeholder:text-ringo-muted focus:border-ringo-indigo focus:outline-none"
      />
      <div className="mt-2 flex items-center justify-between gap-3">
        <p id={`${id}-hint`} className="text-[11px] text-ringo-muted">{u.sendHint}</p>
        <button
          type="submit"
          disabled={sending}
          className="inline-flex min-h-[40px] items-center justify-center rounded-full bg-ringo-indigo px-5 text-sm font-medium text-white transition-opacity disabled:opacity-60"
        >
          {sending ? u.sending : u.send}
        </button>
      </div>
      <p role="status" aria-live="polite" className="sr-only">{sending ? u.sending : ""}</p>
      {error && <p role="alert" className="mt-2 text-xs text-rose-700 dark:text-rose-400">{u[error]}</p>}
    </form>
  );
}

/** Retry of a message that FAILED for certain (Meta rejected it, so nothing reached the customer). A new, deliberate send with a new request id. */
export function RetryButton({ conversationId, text }: { conversationId: string; text: string }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const inFlight = useRef(false);

  async function retry() {
    if (inFlight.current) return;
    inFlight.current = true;
    setSending(true);
    setError(null);
    const effect = interpretReply(await postReply(conversationId, text, newRequestId()));
    inFlight.current = false;
    setSending(false);
    setError(effect.error);
    if (effect.refresh) router.refresh();
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <button type="button" onClick={() => void retry()} disabled={sending} className="text-[11px] font-medium text-ringo-indigo underline-offset-2 hover:underline disabled:opacity-60">
        {sending ? u.sending : u.retryMessage}
      </button>
      {error && <span role="alert" className="text-[10px] text-rose-700 dark:text-rose-400">{u[error]}</span>}
    </span>
  );
}
