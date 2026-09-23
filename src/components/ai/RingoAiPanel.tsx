"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, History, ImagePlus, LifeBuoy, Loader2, Plus, Send, Sparkles, Trash2, X } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import { AI_MAX_USER_MESSAGE_CHARS } from "@/lib/ai/codes";
import MessageList, { type UiMessage } from "./MessageList";
import type { DraftView } from "@/lib/ai/drafts/view";
import type { ContentView } from "@/lib/ai/content/view";

export type AiStatus = { canSend: boolean; limitReason: string | null; remainingToday: number };

type ConversationRow = { id: string; title: string | null; updatedAt: string };

let localId = 0;
const nextId = () => `local-${++localId}`;

// Same limit POST /api/ai/uploads/image enforces server-side — checked here
// too so the user gets an instant error instead of waiting on a request that
// will be rejected anyway (same pattern as ImageUploadField.tsx).
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// The Ringo AI chat panel. Talks only to /api/ai/* — every decision about
// identity, workspace and limits is made server-side; this component just
// renders the NDJSON stream from /api/ai/chat.
export default function RingoAiPanel({
  status,
  onStatusChange,
  onClose,
}: {
  status: AiStatus;
  onStatusChange: (s: AiStatus) => void;
  onClose: () => void;
}) {
  const { t, locale } = useLanguage();
  const [view, setView] = useState<"chat" | "history">("chat");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [toolStatus, setToolStatus] = useState<string | null>(null);
  const [history, setHistory] = useState<ConversationRow[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, DraftView>>({});
  const [contents, setContents] = useState<Record<string, ContentView>>({});
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, toolStatus]);

  const patchAssistant = useCallback((id: string, patch: Partial<UiMessage> | ((m: UiMessage) => Partial<UiMessage>)) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, ...(typeof patch === "function" ? patch(m) : patch) } : m)));
  }, []);

  const upsertDraft = useCallback((draft: DraftView) => setDrafts((prev) => ({ ...prev, [draft.id]: draft })), []);
  const upsertContent = useCallback((content: ContentView) => setContents((prev) => ({ ...prev, [content.id]: content })), []);

  const attachImage = async (file: File) => {
    setImageError(null);
    if (!file.type.startsWith("image/")) {
      setImageError(t.ringoAi.errors.image_wrong_type);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError(t.ringoAi.errors.image_too_large);
      return;
    }
    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/ai/uploads/image", { method: "POST", body: formData });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || typeof data?.url !== "string") {
        setImageError(t.ringoAi.errors[data?.error as string] ?? t.ringoAi.errors.image_upload_failed);
        return;
      }
      setPendingImage(data.url);
    } catch {
      setImageError(t.ringoAi.errors.image_upload_failed);
    } finally {
      setUploadingImage(false);
    }
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || streaming || !status.canSend) return;
    const imageUrl = pendingImage;
    const assistantId = nextId();
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: "user", content: message, serverId: null },
      { id: assistantId, role: "assistant", content: "", serverId: null, pending: true },
    ]);
    setDraft("");
    setPendingImage(null);
    setImageError(null);
    setStreaming(true);
    setToolStatus(null);

    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, locale, conversationId, imageUrl }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        const code = typeof data?.error === "string" ? data.error : "internal";
        patchAssistant(assistantId, { pending: false, errorCode: code });
        if (["daily_limit", "monthly_limit", "budget_reached"].includes(code)) {
          onStatusChange({ canSend: false, limitReason: code, remainingToday: 0 });
        }
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let newline;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            continue;
          }
          if (event.type === "start") setConversationId(event.conversationId);
          else if (event.type === "text") {
            setToolStatus(null);
            patchAssistant(assistantId, (m) => ({ content: m.content + event.delta }));
          } else if (event.type === "tool") {
            // Separate text written before a tool call from what follows it.
            patchAssistant(assistantId, (m) => ({ content: m.content && !m.content.endsWith("\n\n") ? m.content + "\n\n" : m.content }));
            setToolStatus(event.name);
          } else if (event.type === "draft" && event.draft?.id) {
            // A review card — shown under this reply. Nothing is applied until
            // the owner presses Confirm & Apply on it.
            upsertDraft(event.draft);
            patchAssistant(assistantId, (m) => ({ draftIds: (m.draftIds || []).includes(event.draft.id) ? m.draftIds : [...(m.draftIds || []), event.draft.id] }));
          } else if (event.type === "content" && event.content?.id) {
            // A generated-content card — nothing is written anywhere; it's
            // already "done" the moment it's shown.
            upsertContent(event.content);
            patchAssistant(assistantId, (m) => ({ contentIds: (m.contentIds || []).includes(event.content.id) ? m.contentIds : [...(m.contentIds || []), event.content.id] }));
          } else if (event.type === "done") {
            patchAssistant(assistantId, { pending: false, serverId: event.messageId, truncated: !!event.truncated });
            onStatusChange({ ...status, remainingToday: Math.max(0, status.remainingToday - 1), canSend: status.remainingToday - 1 > 0, limitReason: status.remainingToday - 1 > 0 ? null : "daily_limit" });
          } else if (event.type === "error") {
            patchAssistant(assistantId, { pending: false, errorCode: event.code });
          }
        }
      }
      patchAssistant(assistantId, (m) => (m.pending ? { pending: false, errorCode: m.content ? null : "internal" } : {}));
    } catch {
      patchAssistant(assistantId, (m) => ({ pending: false, errorCode: controller.signal.aborted ? null : "provider_unavailable", content: m.content }));
    } finally {
      setStreaming(false);
      setToolStatus(null);
      abortRef.current = null;
    }
  };

  const startNewChat = () => {
    abortRef.current?.abort();
    setConversationId(null);
    setMessages([]);
    setDrafts({});
    setContents({});
    setView("chat");
  };

  const openHistory = async () => {
    setView("history");
    setHistory(null);
    try {
      const res = await fetch("/api/ai/conversations");
      const data = await res.json();
      setHistory(res.ok ? data.conversations || [] : []);
    } catch {
      setHistory([]);
    }
  };

  const openConversation = async (id: string) => {
    abortRef.current?.abort();
    try {
      const [res, draftsRes] = await Promise.all([
        fetch(`/api/ai/conversations/${id}`),
        fetch(`/api/ai/drafts?conversationId=${encodeURIComponent(id)}`).catch(() => null),
      ]);
      if (!res.ok) return;
      const data = await res.json();
      const loadedDrafts: DraftView[] = draftsRes?.ok ? (await draftsRes.json()).drafts || [] : [];
      const loaded: UiMessage[] = (data.messages || []).map((m: any) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        serverId: m.id,
        rating: m.rating || 0,
        createdAt: m.createdAt,
      }));
      // Each card goes under the reply that prepared it: the first assistant
      // message stored after the draft was created (replies are stored last).
      for (const draft of loadedDrafts) {
        const target =
          loaded.find((m) => m.role === "assistant" && !!m.createdAt && m.createdAt >= draft.createdAt) ??
          [...loaded].reverse().find((m) => m.role === "assistant");
        if (target) target.draftIds = [...(target.draftIds || []), draft.id];
      }
      setConversationId(id);
      setMessages(loaded);
      setDrafts(Object.fromEntries(loadedDrafts.map((dr) => [dr.id, dr])));
      // Content cards are never persisted — a reopened conversation shows its
      // text reply only, same as the design intends.
      setContents({});
      setView("chat");
    } catch {
      // Stay on the list; the user can retry.
    }
  };

  const deleteConversation = async (id: string) => {
    setConfirmDelete(null);
    const res = await fetch(`/api/ai/conversations/${id}`, { method: "DELETE" }).catch(() => null);
    if (res?.ok) {
      setHistory((prev) => (prev || []).filter((c) => c.id !== id));
      if (conversationId === id) startNewChat();
    }
  };

  const rate = async (message: UiMessage, rating: number) => {
    if (!message.serverId) return;
    patchAssistant(message.id, { rating });
    await fetch("/api/ai/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messageId: message.serverId, rating }),
    }).catch(() => null);
  };

  // Regenerate/language-switch on a content card are pure client
  // conveniences — they just send a new chat message; the model has the
  // prior turn in context, so no id needs to be threaded through.
  const regenerateContent = () => send(t.ringoAi.content.regeneratePrompt);
  const switchContentLanguage = (locale: "en" | "fr") => send(locale === "fr" ? t.ringoAi.content.translateToFrenchPrompt : t.ringoAi.content.translateToEnglishPrompt);

  // Human handoff: the existing HelpWidget already opens itself from a
  // `?support=open` deep link on mount — reuse that instead of touching it.
  const talkToTeam = () => {
    const url = new URL(window.location.href);
    url.searchParams.set("support", "open");
    window.location.assign(url.toString());
  };

  return (
    <motion.div
      role="dialog"
      aria-label={t.ringoAi.title}
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 16, scale: 0.98 }}
      transition={{ duration: 0.18 }}
      className="fixed z-50 inset-x-0 bottom-0 top-16 lg:inset-auto lg:bottom-6 lg:right-6 lg:w-[420px] lg:h-[min(82vh,700px)] lg:rounded-2xl rounded-t-2xl border border-ringo-border/70 bg-ringo-surface shadow-[0_24px_64px_-20px_rgba(15,23,42,0.45)] flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-ringo-border/70 bg-gradient-to-r from-ringo-indigo/[0.08] via-fuchsia-500/[0.05] to-transparent shrink-0">
        {view === "history" ? (
          <button onClick={() => setView("chat")} aria-label={t.ringoAi.back} className="w-8 h-8 rounded-xl flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10">
            <ArrowLeft size={16} />
          </button>
        ) : (
          <span className="w-9 h-9 rounded-xl bg-gradient-to-br from-ringo-indigo to-fuchsia-500 text-white flex items-center justify-center shadow-[0_6px_16px_-6px_rgba(79,70,229,0.6)]">
            <Sparkles size={17} />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ringo-text flex items-center gap-1.5">
            {view === "history" ? t.ringoAi.history : t.ringoAi.title}
            {view === "chat" && (
              <span className="text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-ringo-indigo/10 text-ringo-indigo">{t.ringoAi.beta}</span>
            )}
          </p>
          {view === "chat" && <p className="text-xs text-ringo-muted truncate">{t.ringoAi.subtitle}</p>}
        </div>
        {view === "chat" && (
          <>
            <button onClick={openHistory} aria-label={t.ringoAi.history} className="w-8 h-8 rounded-xl flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10">
              <History size={16} />
            </button>
            <button onClick={startNewChat} aria-label={t.ringoAi.newChat} className="w-8 h-8 rounded-xl flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10">
              <Plus size={17} />
            </button>
          </>
        )}
        <button onClick={onClose} aria-label={t.ringoAi.close} className="w-8 h-8 rounded-xl flex items-center justify-center text-ringo-muted hover:bg-ringo-muted/10">
          <X size={16} />
        </button>
      </div>

      {view === "history" ? (
        <div className="flex-1 overflow-y-auto p-3">
          {history === null ? (
            <div className="flex justify-center py-10">
              <Loader2 size={18} className="animate-spin text-ringo-muted" />
            </div>
          ) : history.length === 0 ? (
            <p className="text-xs text-ringo-muted text-center py-10">{t.ringoAi.noHistory}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {history.map((c) => (
                <li key={c.id} className="group flex items-center gap-2 rounded-xl px-3 py-2.5 hover:bg-ringo-muted/10">
                  {confirmDelete === c.id ? (
                    <div className="flex-1 flex items-center gap-2 text-xs">
                      <span className="flex-1 text-ringo-text">{t.ringoAi.deleteConfirm}</span>
                      <button onClick={() => setConfirmDelete(null)} className="text-ringo-muted hover:text-ringo-text">
                        {t.ringoAi.cancel}
                      </button>
                      <button onClick={() => deleteConversation(c.id)} className="font-semibold text-ringo-coral">
                        {t.ringoAi.delete}
                      </button>
                    </div>
                  ) : (
                    <>
                      <button onClick={() => openConversation(c.id)} className="flex-1 min-w-0 text-left">
                        <p className="text-sm text-ringo-text truncate">{c.title || t.ringoAi.untitled}</p>
                        <p className="text-[11px] text-ringo-muted">{new Date(c.updatedAt).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-GB")}</p>
                      </button>
                      <button onClick={() => setConfirmDelete(c.id)} aria-label={t.ringoAi.deleteConversation} className="p-1.5 rounded-lg text-ringo-muted hover:text-ringo-coral">
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-4">
                <div>
                  <p className="text-base font-semibold text-ringo-text">{t.ringoAi.welcomeTitle}</p>
                  <p className="text-sm text-ringo-muted mt-1 leading-relaxed">{t.ringoAi.welcomeBody}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-ringo-muted mb-2">{t.ringoAi.suggestionsTitle}</p>
                  <div className="flex flex-col gap-2">
                    {t.ringoAi.suggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        disabled={!status.canSend}
                        className="text-left text-sm rounded-xl border border-ringo-border/80 px-3 py-2.5 text-ringo-text hover:border-ringo-indigo/50 hover:bg-ringo-indigo/[0.04] transition disabled:opacity-50"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="text-[11px] text-ringo-muted leading-relaxed">{t.ringoAi.readOnlyNote}</p>
              </div>
            ) : (
              <MessageList
                messages={messages}
                toolStatus={toolStatus}
                onRate={rate}
                drafts={drafts}
                onDraftChange={upsertDraft}
                contents={contents}
                onRegenerateContent={regenerateContent}
                onSwitchContentLanguage={switchContentLanguage}
              />
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-ringo-border/70 p-3 shrink-0">
            {!status.canSend && status.limitReason && (
              <p className="text-xs text-ringo-coral mb-2">{t.ringoAi.errors[status.limitReason] ?? t.ringoAi.errors.internal}</p>
            )}
            {(pendingImage || uploadingImage) && (
              <div className="flex items-center gap-2 mb-2 rounded-xl border border-ringo-border/80 bg-ringo-muted/[0.06] px-2 py-1.5">
                <div className="w-9 h-9 rounded-lg overflow-hidden shrink-0 bg-ringo-muted/10 flex items-center justify-center">
                  {uploadingImage ? (
                    <Loader2 size={14} className="animate-spin text-ringo-muted" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={pendingImage as string} alt="" className="w-full h-full object-cover" />
                  )}
                </div>
                <span className="flex-1 text-xs text-ringo-muted truncate">{uploadingImage ? t.ringoAi.uploadingImage : t.ringoAi.imageAttached}</span>
                {!uploadingImage && (
                  <button type="button" onClick={() => setPendingImage(null)} aria-label={t.ringoAi.removeImage} className="p-1 rounded-lg text-ringo-muted hover:text-ringo-text shrink-0">
                    <X size={13} />
                  </button>
                )}
              </div>
            )}
            {imageError && <p className="text-xs text-ringo-coral mb-2">{imageError}</p>}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                send(draft);
              }}
              className="flex items-end gap-2"
            >
              <input
                ref={imageInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) attachImage(file);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => imageInputRef.current?.click()}
                disabled={streaming || uploadingImage || !status.canSend}
                aria-label={t.ringoAi.attachImage}
                className="shrink-0 w-9 h-9 rounded-full border border-ringo-border text-ringo-muted flex items-center justify-center hover:text-ringo-text hover:border-ringo-indigo/50 transition disabled:opacity-40"
              >
                <ImagePlus size={15} />
              </button>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, AI_MAX_USER_MESSAGE_CHARS))}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(draft);
                  }
                }}
                placeholder={t.ringoAi.placeholder}
                rows={1}
                disabled={streaming || !status.canSend}
                className="flex-1 text-sm border border-ringo-border rounded-card px-3 py-2 bg-ringo-bg text-ringo-text resize-none max-h-28 disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!draft.trim() || streaming || !status.canSend}
                aria-label={t.ringoAi.send}
                className="shrink-0 w-9 h-9 rounded-full bg-gradient-to-br from-ringo-indigo to-fuchsia-500 text-white flex items-center justify-center transition disabled:opacity-40 active:scale-95"
              >
                {streaming ? <Loader2 size={15} className="animate-spin" /> : <Send size={14} />}
              </button>
            </form>
            <div className="mt-2 flex items-center justify-between gap-2">
              <button onClick={talkToTeam} className="inline-flex items-center gap-1.5 text-xs font-medium text-ringo-indigo hover:underline">
                <LifeBuoy size={13} />
                {t.ringoAi.talkToTeam}
              </button>
              {status.canSend && <span className="text-[11px] text-ringo-muted">{t.ringoAi.remaining(status.remainingToday)}</span>}
            </div>
            <p className="mt-1.5 text-[10px] leading-snug text-ringo-muted">{t.ringoAi.privacyNotice}</p>
          </div>
        </>
      )}
    </motion.div>
  );
}
