// "I just sent something from THIS browser". The conversation scrolls to the bottom after a message only when the person who is looking at it sent it; a message that arrives from
// the Sales Bot, a colleague, another device or the background refresh never moves them (see scrollPolicy.ts). The composer announces a stored send here, the scroller listens.
export const LOCAL_SEND_EVENT = "ringo-inbox-local-send";
/** How long an announced send may still claim the next new message (the page refresh that shows it normally lands within a second or two). */
export const LOCAL_SEND_WINDOW_MS = 30_000;

export function announceLocalSend(conversationId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(LOCAL_SEND_EVENT, { detail: { conversationId } }));
}
