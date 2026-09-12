"use client";

import { createContext, useContext } from "react";
import { type LucideIcon } from "lucide-react";

// Every editor card (ProfileHeaderCard, WhatsAppCard, TracksCard, …) is a
// self-contained component that renders itself inside an <EditorCard> —
// icon, title, its own border/shadow. Now that each card sits inside its
// own EditorSection dropdown (see Editor.tsx), that dropdown already
// shows the same icon + title in its own header — so a second, nested
// header/border underneath it would just be a duplicate.
//
// Rather than adding a `bare` prop to every card's own public API,
// Editor.tsx wraps each one in <EditorCard.BareGroup> — a context only
// this file reads — so every card already calling
// `<EditorCard icon={...} title={...}>` keeps working completely
// unchanged (including anywhere it's used outside an EditorSection),
// while automatically dropping its own chrome when it happens to render
// inside one.
const BareContext = createContext(false);

export function EditorCardBareGroup({ children }: { children: React.ReactNode }) {
  return <BareContext.Provider value={true}>{children}</BareContext.Provider>;
}

export default function EditorCard({
  icon: Icon,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const bare = useContext(BareContext);

  if (bare) {
    return (
      <div className="flex flex-col gap-4">
        {action && <div className="flex items-center justify-end gap-2 flex-wrap -mt-1">{action}</div>}
        {children}
      </div>
    );
  }

  return (
    <section className="animate-fade-up rounded-[20px] border border-ringo-border/60 bg-ringo-surface p-5 sm:p-6 shadow-[0_1px_2px_rgba(15,23,42,0.03),0_10px_24px_-18px_rgba(15,23,42,0.12)] transition-shadow duration-300 hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_16px_32px_-16px_rgba(15,23,42,0.16)]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-4 mb-4 border-b border-ringo-border/50">
        <div className="flex items-center gap-3 shrink-0">
          <span className="w-8 h-8 rounded-xl bg-ringo-indigo/10 flex items-center justify-center shrink-0">
            <Icon size={15} className="text-ringo-indigo" strokeWidth={2.25} />
          </span>
          <h2 className="text-[15px] font-semibold text-ringo-text tracking-[-0.01em]">{title}</h2>
        </div>
        {action && <div className="flex items-center gap-2 flex-wrap">{action}</div>}
      </div>
      {children}
    </section>
  );
}
