import type { KnowledgeModule } from "../types";

// Keep this module truthful about what exists TODAY. The reading, replying, saved-replies and open/close parts are live. Sending files, the AI
// assistant inside a conversation and the automation settings are built but are rolled out separately (they need a database update first), so they are
// described as "may not be available on your account yet" rather than as live. Update the status and this text together when they are switched on.
export const whatsappInboxModule: KnowledgeModule = {
  id: "whatsapp-inbox",
  version: 1,
  title: "WhatsApp Inbox (replying to customers, saved replies, AI help and automation)",
  summary: "The Inbox for messages customers send to the owner's WhatsApp Business number: reading, replying within the 24-hour window, saved replies, sending files, AI assistant, automation and reminders.",
  appliesTo: {},
  status: "partial",
  whoCanUse: "Account OWNERS whose WhatsApp Business number has been connected to Ringo. It appears as Inbox in the dashboard menu only for those accounts. Staff members and accounts without a connected number do not see it.",
  body: `
What it is: a shared inbox, inside the dashboard, for the WhatsApp messages your customers send to your business number. Open Dashboard → Inbox. The list shows conversations (Open, Closed or All, with a search box for a name or number); opening one shows the messages. Customer messages are shown as plain text only.

Replying: type in the reply box and press Send. WhatsApp only allows a free-form reply within 24 hours of the customer's last message ("the reply window"). When the window is closed the box says so and nothing can be sent; writing to a customer first, after the window, needs an approved WhatsApp template message, which Ringo does not support yet. A message shows Sent, Delivered, Read or Failed; a message whose result was never confirmed says "not confirmed" and is never sent again automatically. A failed text message has a Retry button.

Saved replies: reusable texts you write yourself (Dashboard → Inbox → saved replies). Choosing one only puts its text in the reply box; you can edit it and you still press Send. Up to 50 per account.

Close and reopen: closing a conversation only changes its label. A new customer message reopens it. Nothing is deleted.

Files and photos: customers' images, audio, video and documents are shown as a small card (type, file name, caption) — Ringo does not download or keep the file itself. You can attach ONE file to a reply (image JPEG/PNG, video MP4, audio, PDF, Office or text document), up to 4 MB, with an optional caption (not for audio). Ringo checks the real file, not just its name, and does not keep a copy of what you send. A file that failed to send must be attached again to retry. This may not be available on your account yet.

AI assistant in a conversation (may not be available on your account yet): two buttons above the reply box. "Summarize" gives a short summary, what is known about the customer and a suggested next step. "Suggest reply" writes a draft answer. A draft is only ever shown to you; "Insert in reply box" puts it in the box, where you can edit it, and nothing is sent until you press Send. It uses your normal Ringo AI allowance and plan, and if Ringo AI is not available to you, replying works exactly the same without it. It can only draft what is in the conversation, so check prices and availability before sending.

Automation settings (may not be available on your account yet): Dashboard → Inbox → Automation. EVERYTHING IS OFF until you turn it on.
- Business hours and time zone (any time zone; if no day is marked open, no hours are set and you count as always open).
- Automatic acknowledgement: ONE short message that you write yourself, sent when a customer writes outside your business hours or every time (your choice), at most once every 12 hours per conversation, and only while the customer's 24-hour window is open. It is not written by AI. It is labelled "Automatic reply" in the conversation and never counts as your own reply.
- Follow-up reminders: a notification to YOU (not a message to the customer) when a customer's last message still has no reply from you after the number of hours you choose (1 to 168). If the 24-hour window has already closed the reminder says so, because a template message would then be needed.
- Notifications (in the Ringo notification bell, in English or French as you choose): a new conversation, a message you sent that could not be delivered, a customer waiting for a reply.

Labels in the list: each open conversation can show a small label — New lead (nobody has replied yet), Active, Needs follow-up, Customer (the contact is linked to one of your customers), Closed. They are only a guide that Ringo works out for you; nothing is changed or sent because of a label.

What Ringo AI chat cannot do here: it cannot read your conversations or customer phone numbers, send or draft messages for you outside the Inbox panel, change automation settings, or connect your WhatsApp number. It can explain how the Inbox works and where each setting is.
`.trim(),
  actions: [
    "Open Dashboard → Inbox to read and reply to customers",
    "Reply within 24 hours of the customer's last message",
    "Write saved replies and insert them into the reply box",
    "Close or reopen a conversation",
    "Attach one file to a reply with an optional caption",
    "Use Summarize or Suggest reply, then edit and press Send yourself",
    "Set business hours, an acknowledgement message and reminders under Inbox → Automation",
  ],
  prerequisites: [
    "A WhatsApp Business number connected to your Ringo account (the Inbox menu entry only appears once it is)",
    "Owner access (staff members cannot open the Inbox)",
    "For the AI buttons: a plan that includes Ringo AI and remaining AI allowance",
  ],
  limitations: [
    "Free-form replies only within 24 hours of the customer's last message; template messages are not available yet",
    "No voice or video calling, no group chats, no bulk or broadcast messages",
    "AI never sends a message by itself, and nothing is ever sent automatically except the one acknowledgement you wrote and switched on",
    "Ringo does not keep customers' files or the files you send; files are limited to 4 MB, one per message",
    "Sending files, the AI buttons and the Automation page may not be available on every account yet",
  ],
  related: ["connect", "notifications_pwa", "business_ai", "customers"],
};
