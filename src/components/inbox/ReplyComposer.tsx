"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bookmark, FileText, Image as ImageIcon, Mic, Paperclip, SendHorizontal, Video, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { announceLocalSend } from "@/lib/inbox/localSend";
import { MAX_REPLY_LENGTH, formatBytes, interpretMedia, interpretReply, newRequestId, postReply, sendAttachment, type ErrorKey, type SendProgress } from "@/lib/inbox/client";
import type { SavedReply } from "@/lib/inbox/data";
import { inspectMp4Blob } from "@/lib/whatsapp/mp4Inspect";
import { ALLOWED_EXTENSIONS, ALLOWED_MIME_TYPES, MEDIA_CAPTION_MAX, MEDIA_TYPES, checkAttachmentMeta, extensionOf, mimeFromExtension, needsStaging, normalizeMime, type OutboundMediaKind } from "@/lib/whatsapp/mediaRules";

// Human reply (WhatsApp): text, or ONE attachment (image, video, audio or document) with an optional caption. Intentionally plain:
//   * Enter inserts a new line (what people expect on a phone); Ctrl/Cmd + Enter, or the Send button, sends. Nothing is sent by an accidental keypress. The hint under the box says so.
//   * one user action = one client_request_id. It is kept across a retry whose outcome is unknown (network error / server error), so pressing
//     Send again can never create a second customer message; it is replaced only after a definite answer. A large video that already reached the staging area is reused, not uploaded again.
//   * the box and the button are locked while a send is in flight, so a double click cannot send twice; the draft and the attachment survive any failure.
//   * the browser only calls Ringo's own routes; the recipient is decided by the conversation, never typed here.
// Layout: the box grows with the text up to a sensible height and then scrolls inside itself; the attach button and the Send button sit at its two ends, apart from anything else.
// (The page's floating Ringo AI and Help buttons are kept clear of this area by ThreadDock and the Inbox's right-hand column.)

type Attachment = { file: File; kind: OutboundMediaKind };
const MEDIA_ICONS: Record<OutboundMediaKind, typeof FileText> = { image: ImageIcon, video: Video, audio: Mic, document: FileText };
const MAX_BOX_PX = 160;

/** A send the server stored (accepted, pending, unconfirmed, or failed with its bubble in the thread): there is a new message of the person's own to show. */
const storedBySend = (r: { kind: string; body?: { ok: boolean; state?: string } }): boolean => r.kind === "response" && !!r.body && (r.body.ok || r.body.state === "failed");

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export default function ReplyComposer({ conversationId, open, savedReplies = null, insert = null, allowMedia = true }: { conversationId: string; open: boolean; savedReplies?: SavedReply[] | null; insert?: { id: number; text: string } | null; allowMedia?: boolean }) {
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
  const [progress, setProgress] = useState<SendProgress | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const mediaRequestId = useRef<string | null>(null);
  const mediaRequestKey = useRef("");
  // a large video that was already uploaded to the staging area by an earlier attempt of THIS send
  const staged = useRef<{ key: string; path: string } | null>(null);

  // The box follows its text up to MAX_BOX_PX, then scrolls inside itself (so the conversation above never has to give up more than that).
  useIsoLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_BOX_PX)}px`;
  }, [text, attachment, open]);

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
    // the message is stored (sent, pending or failed-and-visible): scroll to it once it appears. Nothing else ever scrolls the reader.
    if (storedBySend(result)) announceLocalSend(conversationId);
    if (effect.refresh) router.refresh();
  }

  // A chosen file is checked in the browser first (a convenience: the server re-checks name, type, size AND the file's actual bytes).
  async function pickFile(list: FileList | null) {
    const picked = list?.[0];
    if (fileInput.current) fileInput.current.value = "";
    if (!picked) return;
    const check = checkAttachmentMeta({ name: picked.name, type: picked.type, size: picked.size });
    if (check !== "ok") {
      const video = MEDIA_TYPES[normalizeMime(picked.type) || (mimeFromExtension(extensionOf(picked.name)) ?? "")]?.kind === "video";
      setError(check === "too_large" ? (video ? "mediaVideoTooLarge" : "mediaTooLarge") : check === "empty_file" ? "mediaEmpty" : check === "unsupported_type" ? "mediaUnsupported" : "mediaMismatch");
      return;
    }
    // some browsers report no type for files such as .amr: the extension proposes one (the server still checks the real bytes)
    let file = picked;
    if (!MEDIA_TYPES[normalizeMime(picked.type)]) file = new File([picked], picked.name, { type: mimeFromExtension(extensionOf(picked.name)) ?? picked.type });
    // WhatsApp takes H.264 video and AAC audio only: a video that cannot be sent is refused HERE, before anything is uploaded (the server checks the same rules again)
    if (MEDIA_TYPES[normalizeMime(file.type)].kind === "video") {
      const insp = await inspectMp4Blob(file);
      if (insp && !insp.ok) return setError("mediaCodecUnsupported");
    }
    setAttachment({ file, kind: MEDIA_TYPES[normalizeMime(file.type)].kind });
    setError(null);
    mediaRequestId.current = null;
    staged.current = null;
  }

  function removeAttachment() {
    setAttachment(null);
    setError(null);
    setProgress(null);
    mediaRequestId.current = null;
    staged.current = null;
  }

  async function submitMedia() {
    if (!attachment || inFlight.current) return;
    const caption = attachment.kind === "audio" ? "" : text.trim();
    if (Array.from(caption).length > MEDIA_CAPTION_MAX) return setError("messageTooLong");
    inFlight.current = true;
    setSending(true);
    setError(null);
    const key = `${attachment.file.name}|${attachment.file.size}|${attachment.file.lastModified}|${caption}`;
    if (mediaRequestId.current && key !== mediaRequestKey.current) {
      mediaRequestId.current = null;
      staged.current = null;
    }
    if (!mediaRequestId.current) mediaRequestId.current = newRequestId();
    mediaRequestKey.current = key;
    const reuse = staged.current && staged.current.key === key ? { path: staged.current.path } : null;
    const result = await sendAttachment({
      conversationId,
      file: attachment.file,
      caption,
      clientRequestId: mediaRequestId.current,
      staged: reuse,
      staging: needsStaging(normalizeMime(attachment.file.type), attachment.file.size),
      onProgress: setProgress,
      onStaged: (path) => {
        staged.current = { key, path };
      },
    });
    const effect = interpretMedia(result);
    inFlight.current = false;
    setSending(false);
    setProgress(null);
    if (storedBySend(result)) announceLocalSend(conversationId);
    if (!effect.keepRequestId) {
      mediaRequestId.current = null;
      staged.current = null;
    }
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
    return <p className="shrink-0 border-t border-ringo-border px-4 py-3 text-xs text-ringo-muted">{u.windowClosed}</p>;
  }

  const id = `reply-${conversationId}`;
  const pct = progress && progress.fraction !== null ? Math.round(progress.fraction * 100) : null;
  const statusText = sending && attachment ? (progress?.phase === "uploading" && pct !== null ? u.uploadingPercent(pct) : u.sendingMedia) : sending ? u.sending : "";
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="shrink-0 border-t border-ringo-border bg-ringo-surface/60 px-3 py-2.5 sm:px-4"
      data-testid="reply-composer"
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
            className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-ringo-border px-3 py-1 text-[11px] font-medium text-ringo-text transition-colors hover:bg-ringo-surface disabled:opacity-60"
          >
            <Bookmark size={12} aria-hidden="true" />
            {u.savedReplies}
          </button>
          {pickerOpen && (
            <div id={`${id}-saved`} className="mt-2 rounded-card border border-ringo-border bg-ringo-surface">
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
        <div className="mb-2 rounded-xl border border-ringo-border/70 bg-ringo-muted/10 p-2" data-attachment-kind={attachment.kind}>
          <div className="flex items-center gap-2.5">
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
            <button type="button" onClick={removeAttachment} disabled={sending} aria-label={u.attachmentRemove} className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-ringo-muted hover:bg-ringo-surface hover:text-ringo-text disabled:opacity-60">
              <X size={16} aria-hidden="true" />
            </button>
          </div>
          {sending && (
            <div className="mt-2" data-testid="upload-progress">
              <div
                role="progressbar"
                aria-label={statusText}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={pct ?? undefined}
                className="h-1.5 overflow-hidden rounded-full bg-ringo-muted/20"
              >
                <div className={`h-full rounded-full bg-ringo-indigo ${pct === null ? "w-1/3 animate-pulse motion-reduce:animate-none" : "transition-[width] duration-150 motion-reduce:transition-none"}`} style={pct === null ? undefined : { width: `${pct}%` }} />
              </div>
              <p className="mt-1 text-[10px] text-ringo-muted">{statusText}</p>
            </div>
          )}
        </div>
      )}
      {attachment?.kind === "audio" ? (
        <p className="rounded-card border border-dashed border-ringo-border px-3 py-2 text-xs text-ringo-muted">{u.captionNone}</p>
      ) : null}
      <div className="flex items-end gap-2">
        {allowMedia && <input
          ref={fileInput}
          type="file"
          hidden
          accept={[...ALLOWED_MIME_TYPES, ...ALLOWED_EXTENSIONS.map((e) => `.${e}`)].join(",")}
          onChange={(e) => void pickFile(e.target.files)}
          aria-label={u.attach}
          tabIndex={-1}
        />}
        {allowMedia && <button
          type="button"
          onClick={() => fileInput.current?.click()}
          disabled={sending}
          aria-label={u.attach}
          title={u.mediaHintLimits}
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-ringo-border text-ringo-muted transition-colors hover:bg-ringo-surface hover:text-ringo-text disabled:opacity-60"
        >
          <Paperclip size={18} aria-hidden="true" />
        </button>}
        {attachment?.kind !== "audio" && (
          <textarea
            ref={box}
            id={id}
            value={text}
            rows={1}
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
            className="block max-h-40 min-h-[44px] min-w-0 flex-1 resize-none overflow-y-auto rounded-2xl border border-ringo-border bg-ringo-bg px-3.5 py-2.5 text-sm leading-snug text-ringo-text placeholder:text-ringo-muted [overflow-wrap:anywhere] focus:border-ringo-indigo focus:outline-none"
          />
        )}
        {attachment?.kind === "audio" && <span className="min-w-0 flex-1" />}
        <button
          type="submit"
          disabled={sending}
          aria-label={u.sendAction}
          className="inline-flex h-11 min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-full bg-ringo-indigo px-4 text-sm font-medium text-white transition-opacity hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ringo-indigo disabled:opacity-60"
        >
          <SendHorizontal size={16} aria-hidden="true" />
          <span className="hidden sm:inline">{sending ? u.sending : u.send}</span>
        </button>
      </div>
      <p id={`${id}-hint`} className="mt-1.5 px-1 text-[11px] text-ringo-muted">{u.sendKeysHint}</p>
      <p role="status" aria-live="polite" className="sr-only">{statusText}</p>
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
    const result = await postReply(conversationId, text, newRequestId());
    const effect = interpretReply(result);
    inFlight.current = false;
    setSending(false);
    setError(effect.error);
    if (storedBySend(result)) announceLocalSend(conversationId);
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
