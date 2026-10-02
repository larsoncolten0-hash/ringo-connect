import type { KnowledgeModule } from "../types";

export const editorSavingModule: KnowledgeModule = {
  id: "editor-saving",
  version: 1,
  title: "How the editor saves, warns and previews",
  summary: "Save Changes vs automatic saving, what Add does, link address handling, unsaved-changes warnings, Discard, and what the live preview shows.",
  appliesTo: {},
  status: "live",
  whoCanUse: "Every account owner using the Editor (Dashboard → Editor).",
  body: `
The Editor is a list of dropdown sections; one is open at a time. Sections work in one of two ways:

1. Sections with a "Save Changes" button (Category, WhatsApp, About, Links, the catalogue/shop, the restaurant Menu; the Profile card at the top, which is always visible, has its own Save button): your edits stay on the screen until you press Save. Press it and the section saves, confirms, and closes. If something can't be saved it stays open, keeps your edits, and explains why. Leaving such a section with unsaved edits asks first (Keep Editing or Discard Changes).
2. Sections that save by themselves (Social links, Brand color / Theme, Pinned item, Music tracks and releases, Restaurant settings, Tables, Tracking pixels, music settings): each change is saved as you make it, so there is no Save Changes button. The section shows "Saving…" while a change is on its way. If a change can't be saved it says so in plain words: either the change is undone ("please try again") or your typed value stays with a "Try again" button. Leaving a section with a failed change asks first.

What "Add" does: in Links, the shop (products), the restaurant Menu (dishes) and extra phone numbers, Add creates a row on your screen only ("Not saved yet"). Press Save Changes to keep it. An empty row is simply dropped when you save, so no empty entries are stored. A link needs a web address, a product or dish needs a name; if something is missing the row shows what is needed. New Menu categories start with a real name you can replace. Removing a saved extra phone number takes effect at once, without Save Changes. For music tracks and releases the item is created as soon as you press Add (uploading audio or a cover needs it to exist); a track or release that still has nothing in it is removed again when you close the section, but one with any detail (artist, genre, price, link, audio, cover…) is kept. Restaurant tables are also created as soon as you press Add, with a default name such as "Table 01" that you can rename; a table is a real table with its own QR code, so it is kept until you delete it.

Link addresses: you can type "example.com" without https:// and Ringo adds it when you save (shown in your list). Addresses starting with https://, http://, mailto:, tel:, sms: or whatsapp: are kept as typed. Anything that is not a web address, and script-style addresses such as "javascript:", is refused with a message.

Leaving the Editor: while something is genuinely unsaved (edits waiting for Save Changes, a change that failed to save, or a social-link address typed but not added) the browser asks before closing/refreshing, and clicking another page in the dashboard shows "You have unsaved changes" with Keep Editing / Leave anyway. When nothing is unsaved there is no prompt. The browser's Back button can't be intercepted.

Discard Changes: throws away what you typed but did not save and puts the live preview back to what is saved. Things that already saved by themselves are not undone.

After you save a section, a "Next: …" line suggests the single most useful next step, chosen by the same Profile Health logic as Ringo Home (and respecting suggestions you hid with "Not now" on this device).

Live preview: shows your latest edits, including unsaved ones, and shows the page as visitors will see it on YOUR plan: links and products beyond your plan's limit, and custom colours on plans without custom themes, are not shown, with a note saying so. Nothing is deleted when something is hidden by plan.

Ringo AI cannot save, discard or change any of this for the owner; it can explain what happened and where to fix it.
`.trim(),
  actions: [
    "Press Save Changes in a section to keep edits",
    "Press Add, fill the row in, then Save Changes",
    "Type a link as example.com; https:// is added when you save",
    "Press Try again after a failed automatic save",
    "Use Discard Changes to drop unsaved edits",
    "Follow the Next: line after saving",
  ],
  limitations: [
    "Edits waiting for Save Changes are lost if the page is closed and the browser warning is ignored; drafts are not kept after a refresh.",
    "The browser Back button cannot be intercepted by the unsaved-changes prompt.",
    "Ticket-type editing on the Tickets pages is separate and unchanged.",
  ],
  related: ["profiles", "guidance", "plans"],
};
