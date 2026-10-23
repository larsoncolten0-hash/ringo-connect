import type { KnowledgeModule } from "../types";

export const churchMinistriesModule: KnowledgeModule = {
  id: "church_ministries",
  version: 2,
  title: "Churches & Ministries",
  summary: "Church, parish, ministry, fellowship and choir pages — the shared Ringo page toolkit, the Church section (people, groups, leadership) and Content Studio (Daily Word).",
  appliesTo: { categories: ["church_ministries"] },
  status: "partial",
  body: `
Available when the page has the Churches & Ministries category (local churches, parishes, ministries, fellowships, choirs). Sub-types: Local Church, Parish, Ministry, Fellowship, Choir, Other.

What this category has TODAY: first, the same shared page toolkit every category has — About, links, a catalog labelled "Church Store" / "Boutique de l'église", WhatsApp contact, Community (email and push updates for people who subscribe), QR code and Connect. The default WhatsApp message and the About placeholder are church-worded.

The public page has a church layout: the ministry type (Local Church, Parish, Ministry, Fellowship, Choir) under the name, and a "Visit us" card that shows the church's SERVICE TIMES and LOCATION with a "Get directions" button. The card reads two existing About fields: the owner writes service times in the About section's hours field (labelled "Service times" for a church; separate several with " · " or a new line, for example "Sun 9am · Wed 6pm") and the address in the location field. If neither is filled in, the card does not appear. A new church page can start from a recommended indigo theme (Editor → Theme, "Apply recommended theme"). Never invent service times or an address: use only what the owner gave.

The Church section of the dashboard (Dashboard → Church) has People, Groups and Leadership. It is for the church owner, and for team members the owner gave church permissions to (the owner chooses which, under Team → Roles). Everything in it is PRIVATE to the church and is never shown on the public page.
- People: the church's own roster. The owner adds and edits people (name; optional phone and email for adults; preferred language English or French; status Pending, Active, Inactive or Removed; age group Adult, Youth or Child), searches and filters the list, and opens a person to see their groups and leadership. "Remove from roster" keeps the record and can be undone; "Delete permanently" erases it and needs its own permission. Children (and only children) are special: a child's record holds just a name, an age group and an adult guardian from the same church, never a phone or an email, and only people with the children permissions can see or change it.
- Groups: departments (like Choir or Ushers) and groups (like Youth or Prayer). Each has people with a role: leader, assistant, member, volunteer or worker. Groups can be archived (kept, hidden from the active list) or deleted. A leader of a group is a person on the roster; being a leader does NOT make them staff or give them dashboard access.
- Leadership: private appointments (a title for an adult, with optional start and end dates). An appointment is ended, not deleted, so the history stays. Nothing here appears on the public page.
It is available in English and French. There is no export, no public member directory, no online join request, no attendance and no giving.

Content Studio (Dashboard → Church → Content): the church writes a Daily Word (a short devotional with a title, an optional scripture reference and text, a reflection and an optional prayer) in English and French, saves it as a draft, previews it exactly as visitors will see it, then publishes it, or schedules it for a future date (it stays hidden until that day). Writing drafts and publishing are separate permissions: the owner decides who may publish. The church types its own scripture text in the version it uses; Ringo does not supply Bible text. A published word appears in a "Daily Word" card on the public church page, in the visitor's language (the other language is shown, with a note, if the word is not written in theirs). Only the owner can switch it on for a team member. If the owner cannot see a Content tab, tell them the feature is not enabled for their church yet. Never write, publish or schedule a Daily Word for the owner: help them draft ideas in chat only if they ask, and tell them they must save and publish it themselves.

What does NOT exist yet (do not describe these as available, and never suggest the owner can set them up): Bible reading programmes, care and support, giving or donations, attendance, church reports, exports, a public member directory, joining the church online, notifications when a Daily Word is published, and images in a Daily Word. If asked, say they are planned and not available yet; do not invent steps or screens.

The Business Toolkit (bookkeeping, invoices, reports) is not offered for this category.

Privacy: never ask for, read or discuss member lists, individual giving, counselling or pastoral information, or anyone's religious details beyond what the owner chooses to publish on the page.

Vocabulary: "church", "ministry", "congregation", "service", "programme". Write announcements in the owner's tone; do not invent service times, addresses, leaders' names, doctrine or events — use only what the owner gave.
`.trim(),
  related: ["profiles", "catalog", "connect"],
};
