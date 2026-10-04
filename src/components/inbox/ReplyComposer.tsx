"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, FileText, Image as ImageIcon, Mic, Paperclip, Video, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { MAX_REPLY_LENGTH, formatBytes, interpretMedia, interpretReply, newRequestId, postMedia, postReply, type ErrorKey } from "@/lib/inbox/client";
import type { SavedReply } from "@/lib/inbox/data";
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, MEDIA_CAPTION_MAX, MEDIA_TYPES, checkAttachmentMeta, extensionOf, mimeFromExtension, normalizeMime, type OutboundMediaKind } from "@/lib/whatsapp/mediaRules";

// Human reply (WhatsApp): text, or ONE attachment (image, video, audio or document) with an optional caption. Intentionally plain:
//   * Enter inserts a new line (what people expect on a phone); Ctrl/Cmd + Enter, or the Send button, sends. Nothing is sent by an accidental keypress.
//   * one user action = one client_request_id. It is kept across a retry whose outcome is unknown (network error / server error), so pressing
//     Send again can never create a second customer message; it is replaced only after a definite answer.
//   * the box and the button are locked while a send is in flight, so a double click cannot send twice.
//   * the browser only calls Ringo's own route; the recipient is decided by the conversation, never typed here.

type Attachment = { file: File; kind: OutboundMediaKind };
const MEDIA_ICONS: Record<OutboundMediaKind, typeof FileText> = { image: ImageIcon, video: Video, audio: Mic, document: FileText };

export default function ReplyComposer({ conversationId, open, savedReplies = null, insert = null }: { conversationId: string; open: boolean; savedReplies?: SavedReply[] | null; insert?: { id: number; text: string } | null }) {
  const { t } = useLanguage();
  const u = t.inbox;
  const router = useRouter();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);
  const requestId = useRef<string | null>(null);
  const requestText = useRef("");
  const inFlight = useRef(false);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // One attachment at a time. Its request id follows the same rule as the text one: kept across an unknown outcome, replaced after a definite answer.
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const mediaRequestId = useRef<string | null>(null);
  const mediaRequestKey = useRef("");

  // Inserting a saved reply only puts text in the box (the person reads and edits it, then sends it like any other reply). If an earlier
  // attempt had an unknown outcome, the changed text must not reuse its request id (same rule as typing).
  function insertSaved(body: string) {
    const next = (text.trim() === "" ? body : text.replace(/\s+$/, "") + "\n" + body).slice(0, MAX_REPLY_LENGTH);
    setText(next);
    if (requestId.current && next.trim() !== requestText.current) requestId.current = null;
    if (error === "emptyMessage" || error === "messageTooLong") setError(null);
    setPickerOpen(false);
    box.current?.focus();
  }

  async function submit() {
    if (inFlight.current) return;
    if (attachment) return submitMedia();
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

  // A chosen file is checked in the browser first (a convenience: the server re-checks name, type, size AND the file's actual bytes).
  function pickFile(list: FileList | null) {
    const picked = list?.[0];
    if (fileInput.current) fileInput.current.value = "";
    if (!picked) return;
    const check = checkAttachmentMeta({ name: picked.name, type: picked.type, size: picked.size });
    if (check !== "ok") {
      setError(check === "too_large" ? "mediaTooLarge" : check === "empty_file" ? "mediaEmpty" : check === "unsupported_type" ? "mediaUnsupported" : "mediaMismatch");
      return;
    }
    // some browsers report no type for files such as .amr: the extension proposes one (the server still checks the real bytes)
    let file = picked;
    if (!MEDIA_TYPES[normalizeMime(picked.type)]) file = new File([picked], picked.name, { type: mimeFromExtension(extensionOf(picked.name)) ?? picked.type });
    setAttachment({ file, kind: MEDIA_TYPES[normalizeMime(file.type)].kind });
    setError(null);
    mediaRequestId.current = null;
  }

  function removeAttachment() {
    setAttachment(null);
    setError(null);
    mediaRequestId.current = null;
  }

  async function submitMedia() {
    if (!attachment || inFlight.current) return;
    const caption = attachment.kind === "audio" ? "" : text.trim();
    if (Array.from(caption).length > MEDIA_CAPTION_MAX) return setError("messageTooLong");
    inFlight.current = true;
    setSending(true);
    setError(null);
    const key = `${attachment.file.name}|${attachment.file.size}|${attachment.file.lastModified}|${caption}`;
    if (mediaRequestId.current && key !== mediaRequestKey.current) mediaRequestId.current = null;
    if (!mediaRequestId.current) mediaRequestId.current = newRequestId();
    mediaRequestKey.current = key;
    const result = await postMedia(conversationId, attachment.file, caption, mediaRequestId.current);
    const effect = interpretMedia(result);
    inFlight.current = false;
    setSending(false);
    if (!effect.keepRequestId) mediaRequestId.current = null;
    if (effect.clearAttachment) {
      setAttachment(null);
      setText("");
    }
    setError(effect.error);
    if (effect.refresh) router.refresh();
  }

  // a local preview of a chosen IMAGE only (a blob: URL of the person's own file, revoked as soon as it is not needed)
  useEffect(() => {
    if (!attachment || attachment.kind !== "image") {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(attachment.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [attachment]);

  // text handed over by the AI assistant (the person clicked "Insert"): it only goes into the box, exactly like a saved reply
  // (an insert that already existed when this box appeared, e.g. from another conversation, is ignored)
  const seenInsert = useRef(insert?.id ?? 0);
  useEffect(() => {
    if (insert && insert.id !== seenInsert.current) {
      seenInsert.current = insert.id;
      insertSaved(insert.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insert?.id]);

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
      {savedReplies !== null && (
        <div className="mb-2">
          <button
            type="button"
            aria-expanded={pickerOpen}
            aria-controls={`${id}-saved`}
            disabled={sending}
            onClick={() => setPickerOpen((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full border border-ringo-border px-3 py-1 text-[11px] font-medium text-ringo-text transition-colors hover:bg-ringo-surface disabled:opacity-60"
          >
            <Bookmark size={12} aria-hidden="true" />
            {u.savedReplies}
          </button>
          {pickerOpen && (
            <div id={`${id}-saved`} className="mt-2 rounded-card border border-ringo-border">
              {savedReplies.length === 0 ? (
                <p className="px-3 py-3 text-xs text-ringo-muted">{u.savedRepliesNone}</p>
              ) : (
                <>
                  <p className="border-b border-ringo-border px-3 py-2 text-[11px] text-ringo-muted">{u.savedRepliesHint}</p>
                  <ul className="max-h-48 divide-y divide-ringo-border/60 overflow-y-auto">
                    {savedReplies.map((r) => (
                      <li key={r.id}>
                        <button type="button" onClick={() => insertSaved(r.body)} className="block w-full px-3 py-2 text-left transition-colors hover:bg-ringo-surface">
                          <span className="block text-xs font-medium text-ringo-text">{r.title}</span>
                          <span className="mt-0.5 line-clamp-2 block whitespace-pre-wrap break-words text-[11px] text-ringo-muted">{r.body}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="border-t border-ringo-border px-3 py-2">
                <Link href="/dashboard/inbox/replies" className="text-[11px] font-medium text-ringo-indigo hover:underline">{u.manageSavedReplies}</Link>
              </div>
            </div>
          )}
        </div>
      )}
      {attachment && (
        <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-ringo-border/70 bg-ringo-muted/10 p-2" data-attachment-kind={attachment.kind}>
          {previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-ringo-indigo/10 text-ringo-indigo">
              {(() => { const Icon = MEDIA_ICONS[attachment.kind]; return <Icon size={18} aria-hidden="true" />; })()}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-ringo-text">{attachment.file.name}</p>
            <p className="text-[10px] text-ringo-muted">{u.mediaKinds[attachment.kind]} · {formatBytes(attachment.file.size)}</p>
          </div>
          <button type="button" onClick={removeAttachment} disabled={sending} aria-label={u.attachmentRemove} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-surface hover:text-ringo-text disabled:opacity-60">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {attachment?.kind === "audio" ? (
        <p className="rounded-card border border-dashed border-ringo-border px-3 py-2 text-xs text-ringo-muted">{u.captionNone}</p>
      ) : (
      <textarea
        ref={box}
        id={id}
        value={text}
        rows={2}
        maxLength={MAX_REPLY_LENGTH}
        readOnly={sending}
        placeholder={attachment ? u.captionPlaceholder : u.replyPlaceholder}
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
      )}
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            hidden
            accept={[...ALLOWED_MIME_TYPES, ...ALLOWED_EXTENSIONS.map((e) => `.${e}`)].join(",")}
            onChange={(e) => pickFile(e.target.files)}
            aria-label={u.attach}
            tabIndex={-1}
          />
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            disabled={sending}
            aria-label={u.attach}
            title={u.mediaHint}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-ringo-border text-ringo-muted transition-colors hover:bg-ringo-surface hover:text-ringo-text disabled:opacity-60"
          >
            <Paperclip size={16} aria-hidden="true" />
          </button>
          <p id={`${id}-hint`} className="truncate text-[11px] text-ringo-muted">{u.sendHint}</p>
        </div>
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
