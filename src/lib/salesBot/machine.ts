import { translations } from "@/lib/i18n/translations";
import { detectOperator, normalizeSignupPhone, type SignupMedium } from "@/lib/signupPaymentClient";
import type { Offer, TierKey } from "./offers";

// The Smart Card sales bot as a PURE state machine: (session, customer text, facts) -> (new session, ONE reply, at most one effect). No database, no network, no clock,
// no AI. Every sentence comes from translations.<lang>.inbox.salesBot (EN + FR); every price and subscription line comes from the resolved add-on offers passed in as facts.
// The runner (runner.ts) owns everything with a side effect: persistence, the signup request, the payment request, the human hand-off notice.

export type BotState =
  | "WELCOME" | "CARDS" | "COMPARE" | "CARD_DETAIL" | "HOW_IT_WORKS" | "FAQ" | "RECOMMEND_1" | "RECOMMEND_2"
  | "ASK_NAME" | "ASK_ADDRESS" | "ASK_EMAIL" | "ASK_USERNAME" | "ASK_OPERATOR" | "ASK_PAY_PHONE" | "REVIEW" | "EDIT_MENU"
  | "DISCOVER" | "BUY_METHOD" | "MEETING_INFO"
  | "APPT_CARD" | "APPT_NAME" | "APPT_WHEN" | "APPT_WHERE" | "APPT_NOTE" | "APPT_REVIEW" | "APPT_PAY" | "APPT_DONE"
  | "CREATING" | "PAYMENT" | "COMPLETED" | "HUMAN_HANDOFF";
export const BOT_STATES: BotState[] = ["WELCOME", "CARDS", "COMPARE", "CARD_DETAIL", "HOW_IT_WORKS", "FAQ", "RECOMMEND_1", "RECOMMEND_2", "ASK_NAME", "ASK_ADDRESS", "ASK_EMAIL", "ASK_USERNAME", "ASK_OPERATOR", "ASK_PAY_PHONE", "REVIEW", "EDIT_MENU", "DISCOVER", "BUY_METHOD", "MEETING_INFO", "APPT_CARD", "APPT_NAME", "APPT_WHEN", "APPT_WHERE", "APPT_NOTE", "APPT_REVIEW", "APPT_PAY", "APPT_DONE", "CREATING", "PAYMENT", "COMPLETED", "HUMAN_HANDOFF"];

/**
 * The database (wa_sales_sessions.state, wa_sales_save) already knows the states that existed when it was created, and is not altered for this feature. A state it does not know is
 * therefore stored as one it does, with a small marker in the data, and restored on the way back in: ASK_EMAIL is ASK_ADDRESS + awaitEmail, and the three menu screens added with the
 * four-option main menu (DISCOVER, BUY_METHOD, MEETING_INFO) are HOW_IT_WORKS / CARDS + step. These two functions are the ONLY place that knows about it; whatsappSalesBot.test.mjs checks that
 * every state round-trips and that every stored state is one the database accepts.
 */
const UMBRELLA: Partial<Record<BotState, { stored: BotState; step: string }>> = {
  DISCOVER: { stored: "HOW_IT_WORKS", step: "discover" },
  BUY_METHOD: { stored: "CARDS", step: "method" },
  MEETING_INFO: { stored: "CARDS", step: "meeting" },
  // the details form (WhatsApp: Buy a card now): the card, three free-text questions (name, time, place), the choice of payment (APPT_PAY: online, or on delivery = a booked appointment), a review (Approve) and the "booking approved" screen. APPT_NOTE is kept only for conversations saved before the note question was removed.
  APPT_CARD: { stored: "ASK_ADDRESS", step: "appt_card" },
  APPT_NAME: { stored: "ASK_ADDRESS", step: "appt_name" },
  APPT_WHEN: { stored: "ASK_ADDRESS", step: "appt_when" },
  APPT_WHERE: { stored: "ASK_ADDRESS", step: "appt_where" },
  APPT_NOTE: { stored: "ASK_ADDRESS", step: "appt_note" },
  APPT_REVIEW: { stored: "REVIEW", step: "appt_review" },
  APPT_PAY: { stored: "REVIEW", step: "appt_pay" },
  APPT_DONE: { stored: "WELCOME", step: "appt_done" },
};
export function toStored(state: BotState, data: BotData): { state: BotState; data: BotData } {
  const { awaitEmail: _drop, step: _step, ...rest } = data;
  if (state === "ASK_EMAIL") return { state: "ASK_ADDRESS", data: { ...rest, awaitEmail: true } };
  const u = UMBRELLA[state];
  return u ? { state: u.stored, data: { ...rest, step: u.step } } : { state, data: rest };
}
export function fromStored(state: BotState, data: BotData): { state: BotState; data: BotData } {
  const { awaitEmail, step, ...rest } = data;
  if (state === "ASK_ADDRESS" && awaitEmail === true) return { state: "ASK_EMAIL", data: rest };
  const hit = (Object.entries(UMBRELLA) as [BotState, { stored: BotState; step: string }][]).find(([, u]) => u.stored === state && u.step === step);
  return hit ? { state: hit[0], data: rest } : { state, data: rest };
}

export type Lang = "en" | "fr";
export interface BotData {
  lang?: Lang;
  /** The customer typed fr / en themselves: from then on the language is never guessed from their messages. */
  langLocked?: boolean;
  tier?: TierKey;
  name?: string;
  address?: string;
  email?: string;
  /** Storage details for the e-mail step and the menu screens added with the four-option menu (see toStored / fromStored); never set by the machine itself. */
  awaitEmail?: boolean;
  step?: string;
  /** How the customer chose to get the card, kept while they move through the order. "agent" is only a choice in this phase: nothing is submitted or stored for a meeting. */
  method?: "online" | "agent";
  /** Consecutive menu replies the bot could not read. Reset by any reply it could. Free-text answers (name, e-mail, ...) never count. */
  bad?: number;
  /** The recovery menu (1 agent, 2 main menu, 3 continue) is on screen: 1 / 2 / 3 mean that, whatever state the customer is in. */
  recover?: boolean;
  /** The meeting request being typed (name, preferred time, place, optional note). Cleared when the request is sent or cancelled. Free text: never trusted, validated again by the database. */
  /** The card the customer chose for the meeting (Standard / Pro / Premium); the agent brings the details, so nothing else is asked about it. */
  aCard?: TierKey;
  /** The FCFA price the customer saw on the review screen for that card. It is what gets submitted; if the live price differs when they confirm, nothing is sent and they review again. */
  aPrice?: number;
  aName?: string;
  aWhen?: string;
  aWhere?: string;
  aNote?: string;
  /** How the customer chose to pay, asked before the review: online (the regular online order) or on delivery (an agent comes and is paid in cash; the appointment is booked). */
  aPay?: "online" | "delivery";
  username?: string;
  medium?: SignupMedium;
  payPhone?: string;
  /** After changing one answer from the review screen, go straight back to the review. */
  returnTo?: "REVIEW";
  /** Changing the payment number after an order exists: the next valid number re-sends the payment request. */
  repay?: boolean;
}
export interface Session { state: BotState; data: BotData; handoff: boolean; signupRequestId: string | null; version: number }
export interface Facts {
  offers: Offer[];
  /** The sender's verified WhatsApp number (digits, from Meta). */
  waDigits: string;
  /** Result of the runner's username check for THIS message (only computed in ASK_USERNAME). */
  usernameStatus?: "ok" | "taken" | "unknown";
  /** The authoritative total from computeSignupAmount for the selected card (only computed when the review is shown). */
  total?: number | null;
  /** The session has sat in CREATING for too long (an earlier attempt died): let the customer go back to the review. */
  stuck?: boolean;
  /** The customer's newest meeting request (read by the runner in the screens that need it); undefined when it could not be read. */
  appointment?: { status: "pending" | "confirmed" | "declined" | "cancelled" | "completed" | "none"; open: boolean };
}
export type Effect = "none" | "handoff" | "create_and_pay" | "resend_payment" | "check_payment" | "create_appointment";
/** What the runner passes to the machine when the customer taps the "Get started" button (the only button the bot ever sends). It is never typed text: see step(). */
export const START_TOKEN = "__start__";
/** `button`: the reply is the short welcome, and the runner sends it with the "Get started" button. */
export interface StepResult { state: BotState; data: BotData; handoff: boolean; reply: string; effect: Effect; button?: boolean }

// ------------------------------------------------------------------------------------------------ small helpers
export const norm = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "'").replace(/\s+/g, " ").trim();
const choiceOf = (t: string): number | null => { const m = /^(\d{1,2})[.)]?$/.exec(t); return m ? Number(m[1]) : null; };
const has = (t: string, words: string[]) => words.includes(t);
// Language signals in ONE message (norm() lower-cases and strips accents). Digits, menu words and names carry no signal: the language then stays as it was.
const FR_WORDS = /\b(bonjour|bonsoir|salut|merci|oui|je|veux|voudrais|souhaite|commander|commande|acheter|carte|cartes|comment|svp|aide|humain|prix|combien|quelle|quel|quels|quelles|livraison|livrer|abonnement|paiement|payer|vous|votre|vos|avez|pourquoi|pouvez|peux|ca|marche|fonctionne|renseignement|informations?|disponible|le|la|les|des|une|pour|avec|sans|mon|ma|mes|c'est|j'ai|s'il)\b/g;
const EN_WORDS = /\b(hello|hi|hey|thanks|thank|please|yes|how|what|which|price|prices|cost|order|buy|want|need|would|like|card|cards|help|delivery|deliver|pay|payment|subscription|you|your|do|does|can|could|is|are|the|this|that|with|for|my|me|i|it|work|works|available|information|details)\b/g;
const FR_ACCENT = /[àâçéèêëîïôùûü]/;
/** The language of a message when it clearly is one; null when it gives no signal. */
export function languageSignal(raw: string): Lang | null {
  const lowered = String(raw ?? "").toLowerCase();
  const t = norm(raw);
  const fr = (t.match(FR_WORDS)?.length ?? 0) + (FR_ACCENT.test(lowered) ? 2 : 0);
  const en = t.match(EN_WORDS)?.length ?? 0;
  if (fr === en) return null;
  return fr > en ? "fr" : "en";
}
export const detectLang = (t: string): Lang => languageSignal(t) ?? "en";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (s: string, max: number) => s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

const HUMAN_WORDS = ["human", "agent", "support", "representative", "representant", "talk to someone", "speak to someone", "talk to a person", "someone", "help", "real person", "humain", "conseiller", "assistance", "aide", "parler a quelqu'un", "parler a quelqu un", "parler a une personne", "quelqu'un"];
const HUMAN_LOOSE = /\b(human|agent|representative|talk to (a )?(someone|person|human)|speak to (a )?(someone|person|human)|real person|help|support|humain|conseiller|assistance|aide|parler a (quelqu|une personne))/;
const MENU_WORDS = ["0", "menu", "main menu", "menu principal"];
const GREET_WORDS = ["start", "hi", "hello", "hey", "bonjour", "bonsoir", "salut", "hola"];
// Price questions start the same way as buying: online or with an agent first, then the plans.
const PRICE_WORDS = ["price", "prices", "prix", "tarif", "tarifs", "cost", "how much", "combien", "cards", "cartes", "card", "carte", "see the cards", "voir les cartes"];
const DISCOVER_WORDS = ["discover", "discover ringo", "decouvrir", "decouvrir ringo", "what is ringo"];
const KNOW_MORE_WORDS = ["know more", "en savoir plus", "question", "questions", "faq", "how it works", "comment ca marche", "how"];
const ONLINE_WORDS = ["online", "pay online", "en ligne", "payer en ligne"];
const CANCEL_WORDS = ["cancel", "reset", "restart", "annuler", "recommencer", "stop"];
const IMAGE_WORDS = ["image", "images", "photo", "photos", "picture", "pictures", "see image", "see images", "see the card", "voir image", "voir images", "voir les images", "voir des images", "voir la carte", "voir photo", "voir photos"];
const ORDER_WORDS = ["order", "buy", "buy a card", "acheter une carte", "i want to order", "commander", "acheter", "commande", "je veux commander"];
const SKIP_WORDS = ["skip", "no", "none", "passer", "non", "aucun", "pas besoin"];
const FREE_TEXT: BotState[] = ["ASK_NAME", "ASK_ADDRESS", "ASK_EMAIL", "ASK_USERNAME", "ASK_PAY_PHONE", "APPT_NAME", "APPT_WHEN", "APPT_WHERE", "APPT_NOTE"];
const APPT_FLOW: BotState[] = ["APPT_CARD", "APPT_NAME", "APPT_WHEN", "APPT_WHERE", "APPT_NOTE", "APPT_REVIEW", "APPT_PAY"];
const DELIVERY_WORDS = ["delivery", "pay on delivery", "cash", "livraison", "payer a la livraison", "especes"];
const STATUS_WORDS = ["status", "statut"];
const ORDER_FLOW: BotState[] = ["ASK_NAME", "ASK_ADDRESS", "ASK_EMAIL", "ASK_USERNAME", "ASK_OPERATOR", "ASK_PAY_PHONE", "REVIEW", "EDIT_MENU"];

export const groupNum = (n: number, sep: string) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, sep);
const lastDigits = (phone: string) => phone.slice(-3);

function S(lang: Lang) { return translations[lang].inbox.salesBot; }
function money(lang: Lang, n: number) { const T = S(lang); return T.price(groupNum(n, T.thousandsSep)); }
/** The one-line subscription description (used on the payment receipt). */
export function subscriptionLine(lang: Lang, o: Offer): string {
  const T = S(lang);
  return T.subscription(T.period(o.days), cap(o.planName));
}
// What each card is listed with in WhatsApp: ONE short, fixed list per tier (translations.<lang>.inbox.salesBot.tierFeatures), written for this bot only. It does not read the plans table or the add-on
// features, so it never changes with the platform's plan configuration. The prices still come from the live add-on rows. The first line of each list is that tier's subscription, without a duration.
function offerLines(lang: Lang, o: Offer): string[] {
  return [...S(lang).tierFeatures[o.tier]];
}
const offerFor = (facts: Facts, tier?: TierKey) => facts.offers.find((o) => o.tier === tier);

// ------------------------------------------------------------------------------------------------ screens
function cardsScreen(lang: Lang, facts: Facts): string {
  const T = S(lang);
  if (facts.offers.length === 0) return T.unavailable;
  const body = facts.offers.map((o, i) => T.cardLine(i + 1, T.tierLabel[o.tier], money(lang, o.priceXaf), offerLines(lang, o))).join("");
  return `${T.cardsIntro}${body}${T.cardsFooter(facts.offers.length + 1, facts.offers.length + 2)}`;
}
// The card choice of the meeting flow: the same short card lists as the online flow, but the customer only picks one (no further questions about it).
function apptCardsScreen(lang: Lang, facts: Facts): string {
  const T = S(lang);
  const body = facts.offers.map((o, i) => T.cardLine(i + 1, T.tierLabel[o.tier], money(lang, o.priceXaf), offerLines(lang, o))).join("");
  return `${T.apptCardsIntro}${body}${T.apptCardsFooter}`;
}
function compareScreen(lang: Lang, facts: Facts): string {
  const T = S(lang);
  return `${T.compareTitle}${facts.offers.map((o) => T.compareLine(T.tierLabel[o.tier], money(lang, o.priceXaf), offerLines(lang, o))).join("")}${T.compareSame}${T.compareOptions}`;
}
function detailScreen(lang: Lang, o: Offer): string {
  const T = S(lang);
  return `${T.cardTitle(T.tierLabel[o.tier], money(lang, o.priceXaf))}\n${offerLines(lang, o).map((l) => `• ${l}`).join("\n")}\n\n${T.cardAbout}${T.cardOptions}`;
}
function includedAnswer(lang: Lang, facts: Facts): string {
  const T = S(lang);
  const all = (k: "hasQr" | "hasConfig") => facts.offers.length > 0 && facts.offers.every((o) => o[k]);
  const lines = [...(all("hasQr") ? [T.qrIncluded] : []), ...(all("hasConfig") ? [T.configIncluded] : []), ...facts.offers.map((o) => `${T.tierLabel[o.tier]}: ${T.tierFeatures[o.tier][0]}`)];
  return T.faqIncluded(lines);
}
function reviewScreen(lang: Lang, d: BotData, facts: Facts, waDigits: string): string | null {
  const T = S(lang);
  const o = offerFor(facts, d.tier);
  if (!o || !d.name || !d.address || !d.email || !d.medium || !d.payPhone || typeof facts.total !== "number") return null;
  return T.review({ label: T.tierLabel[o.tier], price: money(lang, o.priceXaf), total: money(lang, facts.total), name: d.name, email: d.email, username: d.username || null, phone: `+${waDigits}`, address: d.address, operator: T.operatorName[d.medium], last3: lastDigits(d.payPhone) });
}
function apptReviewScreen(lang: Lang, d: BotData, facts: Facts): string | null {
  const waDigits = facts.waDigits;
  if (!d.aName || !d.aWhen || !d.aWhere) return null;
  const T = S(lang);
  const o = offerFor(facts, d.aCard);
  return T.apptReview({ card: o ? `${T.tierLabel[o.tier]} — ${money(lang, d.aPrice ?? o.priceXaf)}` : null, name: d.aName, phone: `+${waDigits}`, when: d.aWhen, where: d.aWhere, note: d.aNote || null });
}
function payPhonePrompt(lang: Lang, waDigits: string): string {
  const own = normalizeSignupPhone(waDigits);
  return S(lang).askPayPhone(own ? lastDigits(own) : null);
}

function prompt(state: BotState, d: BotData, facts: Facts, lang: Lang): string {
  const T = S(lang);
  const o = offerFor(facts, d.tier);
  switch (state) {
    case "WELCOME": case "COMPLETED": case "HUMAN_HANDOFF": return T.mainMenu;
    case "DISCOVER": return T.discover;
    // The two screens that used to come before the card choice are gone: a session still stored on one of them sees the card choice instead.
    case "BUY_METHOD": case "MEETING_INFO": return facts.offers.length > 0 ? apptCardsScreen(lang, facts) : T.unavailable;
    case "APPT_PAY": return T.apptPayChoice;
    case "APPT_CARD": return facts.offers.length > 0 ? apptCardsScreen(lang, facts) : T.apptAskName;
    case "APPT_NAME": return T.apptAskName;
    case "APPT_WHEN": return T.apptAskWhen;
    case "APPT_WHERE": return T.apptAskWhere;
    case "APPT_NOTE": return T.apptAskNote;
    case "APPT_REVIEW": return apptReviewScreen(lang, d, facts) ?? T.apptAskName;
    case "APPT_DONE": return facts.appointment ? T.apptStatusText(facts.appointment.status) : T.apptStatusUnknown;
    case "CARDS": return cardsScreen(lang, facts);
    case "COMPARE": return compareScreen(lang, facts);
    case "CARD_DETAIL": return o ? detailScreen(lang, o) : cardsScreen(lang, facts);
    case "HOW_IT_WORKS": return `${T.howItWorks}${T.howOptions}`;
    case "FAQ": return T.faqMenu;
    case "RECOMMEND_1": return T.rec1;
    case "RECOMMEND_2": return T.rec2;
    case "ASK_NAME": return T.askName(o ? T.tierLabel[o.tier] : "");
    case "ASK_ADDRESS": return T.askAddress;
    case "ASK_EMAIL": return T.askEmail;
    case "ASK_USERNAME": return T.askUsername;
    case "ASK_OPERATOR": return T.askOperator;
    case "ASK_PAY_PHONE": return payPhonePrompt(lang, facts.waDigits);
    case "REVIEW": return reviewScreen(lang, d, facts, facts.waDigits) ?? T.orderFailed;
    case "EDIT_MENU": return T.editMenu;
    case "CREATING": return T.creating;
    case "PAYMENT": return T.paymentResumed;
  }
}

/** The first prompt of the order: the customer picked a card. */
function startOrder(d: BotData, facts: Facts, lang: Lang): StepResult | null {
  if (!offerFor(facts, d.tier)) return null;
  const next: BotData = { lang: d.lang, tier: d.tier, ...(d.method ? { method: d.method } : {}), ...(d.langLocked ? { langLocked: true } : {}) };
  return { state: "ASK_NAME", data: next, handoff: false, reply: prompt("ASK_NAME", next, facts, lang), effect: "none" };
}

// ------------------------------------------------------------------------------------------------ the machine
export function step(session: Session, rawText: string, facts: Facts): StepResult {
  const text = clean(String(rawText ?? ""), 500);
  const t = norm(text);
  const d: BotData = { ...session.data };
  const state = session.state;
  // The reply language follows the customer's own message (French in, French out; English in, English out). A typed fr / en is a choice they made, so it is kept (langLocked).
  // Answers to free-text questions (a name, an address, an e-mail) say nothing about language, and neither do numbers or menu words.
  const signal = d.langLocked || FREE_TEXT.includes(state) ? null : languageSignal(text);
  // The very first reply of a brand-new conversation is French whatever the customer wrote (most customers speak French, and the Facebook ad opens the chat in English). A typed en / fr still wins, below.
  const firstContact = session.version === 0 && state === "WELCOME" && !d.lang;
  const lang: Lang = firstContact ? "fr" : signal ?? d.lang ?? "en";
  d.lang = lang;
  const T = S(lang);
  // Any reply the bot could read ends a run of unreadable ones: the counter and the recovery menu never outlive the reply that answers them.
  const out = (s: BotState, data: BotData, reply: string, effect: Effect = "none", handoff = false): StepResult => {
    const { bad: _bad, recover: _recover, ...kept } = data;
    return { state: s, data: kept, handoff, reply, effect };
  };
  const stay = (reply: string) => out(state, d, reply);
  // A menu reply that matches nothing. 1st: say how the menu works; 2nd: shorter, with the human route; 3rd and later: the recovery menu. The place in the conversation and everything collected stay.
  const confused = (): StepResult => {
    const bad = (d.bad ?? 0) + 1;
    const here = prompt(state, d, facts, lang);
    const reply = bad === 1 ? `${T.didNotUnderstand}\n\n${here}\n\n${T.invalidTail}` : bad === 2 ? `${T.invalidShort}\n\n${here}` : T.recoveryMenu;
    return { state, data: { ...d, bad, ...(bad >= 3 ? { recover: true } : {}) }, handoff: false, reply, effect: "none" };
  };
  const toHuman = () => out("HUMAN_HANDOFF", d, T.handoff, "handoff", true);
  const mainMenu = (body: string): StepResult => {
    const r = out("WELCOME", { lang, ...(d.langLocked ? { langLocked: true } : {}) }, `${ORDER_FLOW.includes(state) ? `${T.cancelled}\n\n` : APPT_FLOW.includes(state) ? `${T.apptCancelled}\n\n` : ""}${body}`);
    return body === T.welcome ? { ...r, button: true } : r;
  };

  // "Buy a card now": the card choice comes first, then the details, then how to pay. Whatever an earlier attempt left behind is cleared.
  const startBuy = (): StepResult => {
    const fresh: BotData = { lang, ...(d.langLocked ? { langLocked: true } : {}) };
    return facts.offers.length > 0 ? out("APPT_CARD", fresh, apptCardsScreen(lang, facts)) : out("WELCOME", fresh, T.unavailable);
  };

  if (session.handoff || state === "HUMAN_HANDOFF") return { state: "HUMAN_HANDOFF", data: d, handoff: true, reply: "", effect: "none" };
  if (!t) return confused();

  // The "Get started" button was tapped. At the start of the conversation it opens the main menu; in the middle of anything else it only shows the current question again (nothing is cleared, counted or answered).
  if (t === START_TOKEN) return state === "WELCOME" || state === "COMPLETED" ? mainMenu(T.mainMenu) : out(state, d, prompt(state, d, facts, lang));

  // A human on request, at any point. Free-text answers (a name, an address) only match a bare request, never a word inside an address.
  const wantsHuman = FREE_TEXT.includes(state) ? has(t, HUMAN_WORDS) : HUMAN_LOOSE.test(t) || has(t, HUMAN_WORDS);
  if (wantsHuman) return toHuman();

  // Language: any time, keeps the place in the conversation.
  if (has(t, ["fr", "francais", "french"]) || has(t, ["en", "english", "anglais"])) {
    const to: Lang = has(t, ["fr", "francais", "french"]) ? "fr" : "en";
    const nd = { ...d, lang: to, langLocked: true };
    const first = ORDER_FLOW.includes(state) || APPT_FLOW.includes(state) || state === "PAYMENT" || state === "CREATING";
    const switched = out(first ? state : "WELCOME", nd, `${S(to).langSwitched}\n\n${first ? prompt(state, nd, facts, to) : S(to).welcome}`);
    return first ? switched : { ...switched, button: true };
  }

  if (state === "CREATING") {
    if (facts.stuck) return out("REVIEW", d, prompt("REVIEW", d, facts, lang));
    return stay(T.creating);
  }

  // 0 / menu / cancel: always works. Inside the order it clears the half-made order; nothing has been created or charged yet. A greeting shows the full welcome, 0 the short menu.
  if (has(t, MENU_WORDS) || has(t, CANCEL_WORDS) || has(t, GREET_WORDS)) return mainMenu(has(t, GREET_WORDS) ? T.welcome : T.mainMenu);

  const n = choiceOf(t);

  // The recovery menu is on screen: its three numbers mean what it says, whatever the state behind it. Anything else is read as usual.
  if (d.recover && n !== null && n >= 1 && n <= 3) {
    if (n === 1) return toHuman();
    if (n === 2) return mainMenu(T.mainMenu);
    return out(state, d, prompt(state, d, facts, lang));
  }

  switch (state) {
    case "WELCOME":
    case "COMPLETED": {
      if (state === "WELCOME" && has(t, STATUS_WORDS) && facts.appointment) return out("WELCOME", d, T.apptStatusText(facts.appointment.status));
      // The four-option main menu: 1 Buy a card now, 2 Discover Ringo, 3 Know more, 4 Speak with a Ringo agent. The words below are shortcuts to the same places.
      if (n === 1 || has(t, ORDER_WORDS) || has(t, PRICE_WORDS)) return startBuy();
      if (n === 2 || has(t, DISCOVER_WORDS)) return out("DISCOVER", d, T.discover);
      if (n === 3 || has(t, KNOW_MORE_WORDS)) return out("FAQ", d, T.faqMenu);
      if (n === 4) return toHuman();
      // Pictures: the official Ringo profile shows the card; the bot just points there (it never sends or invents images).
      if (has(t, IMAGE_WORDS)) return out(state === "COMPLETED" ? "COMPLETED" : "WELCOME", d, T.imagesInfo);
      if (state === "COMPLETED") return out("COMPLETED", d, T.afterPaid);
      // 5 and 6 were options of the previous six-option menu. At the main menu ONLY (never inside an order, where every digit keeps its own meaning) they get one short notice and the current
      // menu: mapped to nothing, and not counted as an unreadable reply. The recovery menu is not on screen any more, so its flag is dropped; the counter is left exactly as it was.
      if ((n === 5 || n === 6) && session.version > 0) { const { recover: _r, ...keep } = d; return { state, data: keep, handoff: false, reply: `${T.menuUpdated}\n\n${T.mainMenu}`, effect: "none" }; }
      // A brand-new conversation (nothing saved yet) gets the welcome, never an apology for not understanding a first message.
      return session.version === 0 ? mainMenu(T.welcome) : confused();
    }
    case "DISCOVER": {
      if (n === 1) return startBuy();
      if (n === 2) return toHuman();
      if (n === 3) return mainMenu(T.mainMenu);
      return confused();
    }
    case "BUY_METHOD":
    case "MEETING_INFO": {
      // Screens that no longer exist: a session still stored on one of them is taken to the card choice.
      return startBuy();
    }
    case "APPT_CARD": {
      const pick = n !== null && n >= 1 && n <= facts.offers.length ? facts.offers[n - 1] : facts.offers.find((o) => has(t, [norm(T.tierLabel[o.tier]), o.tier]));
      if (!pick) return confused();
      d.aCard = pick.tier;
      return out("APPT_NAME", d, T.apptAskName);
    }
    case "APPT_NAME": {
      const v = clean(text, 80);
      if (v.length < 2) return stay(T.apptAskName);
      d.aName = v;
      return out("APPT_WHEN", d, T.apptAskWhen);
    }
    case "APPT_WHEN": {
      const v = clean(text, 80);
      if (v.length < 3) return stay(T.apptAskWhen);
      d.aWhen = v;
      return out("APPT_WHERE", d, T.apptAskWhere);
    }
    case "APPT_WHERE": {
      const v = clean(text, 160);
      if (v.length < 3) return stay(T.apptAskWhere);
      d.aWhere = v;
      // no optional note any more: the details are complete, so the card and price the customer saw are kept. The customer now chooses how to pay, then reviews everything
      // (a request made without a card has nothing to pay online, so it goes straight to the review).
      d.aPrice = offerFor(facts, d.aCard)?.priceXaf;
      return d.aCard ? out("APPT_PAY", d, T.apptPayChoice) : out("APPT_REVIEW", d, prompt("APPT_REVIEW", d, facts, lang));
    }
    case "APPT_NOTE": {
      d.aNote = has(t, SKIP_WORDS) ? undefined : clean(text, 200) || undefined;
      // the price shown on the review screen is the one the customer reviews: it is kept, and it is what is submitted
      d.aPrice = offerFor(facts, d.aCard)?.priceXaf;
      return out("APPT_REVIEW", d, prompt("APPT_REVIEW", d, facts, lang));
    }
    case "APPT_REVIEW": {
      if (!d.aName || !d.aWhen || !d.aWhere) return out("APPT_NAME", d, T.apptAskName);
      // 1 sends the request: the runner stores it (the database re-validates everything and ignores a repeat) and writes the answer. It never touches an order or a payment.
      if (n === 1) {
        // Immediately before sending, the reviewed card and price are compared with the live offer. If the offer is gone or the price moved, nothing is sent: the customer is told and reviews again.
        if (d.aCard) {
          const live = offerFor(facts, d.aCard);
          if (!live) {
            const gone = { ...d, aCard: undefined, aPrice: undefined };
            return facts.offers.length > 0 ? out("APPT_CARD", gone, `${T.apptCardUnavailable}${apptCardsScreen(lang, facts)}`) : out("APPT_NAME", gone, `${T.apptCardUnavailable}${T.apptAskName}`);
          }
          if (d.aPrice !== live.priceXaf) {
            const was = d.aPrice;
            d.aPrice = live.priceXaf;
            return out("APPT_REVIEW", d, `${T.apptPriceChanged({ was: typeof was === "number" ? money(lang, was) : null, now: money(lang, live.priceXaf) })}${prompt("APPT_REVIEW", d, facts, lang)}`);
          }
        }
        // Approved. Pay on delivery (or a request made without a card, which can only be booked): the appointment is booked from the details already given; the runner stores it and tells the customer.
        if (!d.aCard || d.aPay === "delivery") return out("APPT_REVIEW", d, "", "create_appointment");
        // Pay online: the regular online order (e-mail, username, Mobile Money number, review, payment request) with the card, name and place already given. Nothing is asked twice.
        const live = d.aPay === "online" ? offerFor(facts, d.aCard) : undefined;
        if (live) {
          const order: BotData = { lang, tier: live.tier, method: "online", name: d.aName, ...(d.langLocked ? { langLocked: true } : {}) };
          // the delivery address of the online order needs 5 characters (ASK_ADDRESS); the meeting place only 3
          if (d.aWhere.length < 5) return out("ASK_ADDRESS", order, T.askAddress);
          return out("ASK_EMAIL", { ...order, address: d.aWhere }, T.askEmail);
        }
        // A conversation saved before the choice of payment moved ahead of this review has no choice stored yet: it is asked now.
        return out("APPT_PAY", d, T.apptPayChoice);
      }
      if (n === 2) {
        const cleared = { ...d, aCard: undefined, aPrice: undefined, aName: undefined, aWhen: undefined, aWhere: undefined, aNote: undefined, aPay: undefined };
        return facts.offers.length > 0 ? out("APPT_CARD", cleared, apptCardsScreen(lang, facts)) : out("APPT_NAME", cleared, T.apptAskName);
      }
      return confused();
    }
    case "APPT_PAY": {
      if (!d.aName || !d.aWhen || !d.aWhere) return out("APPT_NAME", d, T.apptAskName);
      // The choice is only remembered here; it is acted on when the customer approves the review that follows.
      if (n === 1 || has(t, ONLINE_WORDS)) { d.aPay = "online"; return out("APPT_REVIEW", d, prompt("APPT_REVIEW", d, facts, lang)); }
      if (n === 2 || has(t, DELIVERY_WORDS)) { d.aPay = "delivery"; return out("APPT_REVIEW", d, prompt("APPT_REVIEW", d, facts, lang)); }
      return confused();
    }
    case "APPT_DONE": {
      // After a request was sent (or the customer already had one) every message is answered with where it stands; 0 / menu / human work everywhere as usual.
      return out("APPT_DONE", d, prompt("APPT_DONE", d, facts, lang));
    }
    case "CARDS": {
      const pick = n !== null && n >= 1 && n <= facts.offers.length ? facts.offers[n - 1] : facts.offers.find((o) => has(t, [norm(T.tierLabel[o.tier]), o.tier]));
      if (pick) { d.tier = pick.tier; return out("CARD_DETAIL", d, detailScreen(lang, pick)); }
      if ((n !== null && n === facts.offers.length + 1) || has(t, ["compare", "comparer"])) return out("COMPARE", d, compareScreen(lang, facts));
      if ((n !== null && n === facts.offers.length + 2) || has(t, ["choose", "choisir", "recommend", "recommander"])) return out("RECOMMEND_1", d, T.rec1);
      return confused();
    }
    case "COMPARE": {
      if (n === 1 || n === 2 || has(t, ORDER_WORDS)) return out("CARDS", d, cardsScreen(lang, facts));
      if (n === 3) return out("RECOMMEND_1", d, T.rec1);
      return confused();
    }
    case "CARD_DETAIL": {
      if (n === 1 || has(t, ORDER_WORDS)) {
        const o = offerFor(facts, d.tier);
        if (!o) return out("CARDS", d, cardsScreen(lang, facts));
        // Changing the card from the review keeps the answers already given.
        if (d.returnTo === "REVIEW" && d.name && d.address && d.email && d.medium && d.payPhone) { d.returnTo = undefined; return out("REVIEW", d, prompt("REVIEW", d, facts, lang)); }
        return startOrder(d, facts, lang) ?? out("CARDS", d, cardsScreen(lang, facts));
      }
      if (n === 2) return out("CARDS", d, cardsScreen(lang, facts));
      return confused();
    }
    case "HOW_IT_WORKS": {
      if (n === 1 || has(t, ORDER_WORDS)) return startBuy();
      if (n === 2) return startBuy(); // the old "See the cards": the card choice always comes first
      if (n === 3) return out("FAQ", d, T.faqMenu);
      return confused();
    }
    case "FAQ": {
      if (has(t, ORDER_WORDS)) return startBuy();
      if (has(t, ["faq", "questions", "question"])) return out("FAQ", d, T.faqMenu);
      if (n !== null && n >= 1 && n <= T.faq.length) {
        const answer = n === 9 ? includedAnswer(lang, facts) : T.faq[n - 1];
        return out("FAQ", d, `${answer}${T.faqOptions}`);
      }
      return confused();
    }
    case "RECOMMEND_1": {
      if (n === 1) return out("RECOMMEND_2", d, T.rec2);
      if (n === 2) return recommend(["premium", "standard"]);
      return confused();
    }
    case "RECOMMEND_2": {
      if (n === 1) return recommend(["pro", "standard"]);
      if (n === 2) return recommend(["standard", "pro"]);
      return confused();
    }
    case "ASK_NAME": {
      const name = clean(text, 80);
      if (name.length < 2) return stay(T.askName(offerFor(facts, d.tier) ? T.tierLabel[d.tier!] : ""));
      d.name = name;
      return advance("ASK_ADDRESS");
    }
    case "ASK_ADDRESS": {
      const address = clean(text, 200);
      if (address.length < 5) return stay(T.askAddress);
      d.address = address;
      return advance("ASK_EMAIL");
    }
    case "ASK_EMAIL": {
      // Needed so the Ringo team can e-mail the login details when the request is approved. One address, no spaces.
      const email = text.trim().toLowerCase();
      if (email.length > 120 || !EMAIL_RE.test(email)) return stay(T.emailInvalid);
      d.email = email;
      return advance("ASK_USERNAME");
    }
    case "ASK_USERNAME": {
      if (has(t, SKIP_WORDS)) { d.username = undefined; return advance("ASK_OPERATOR"); }
      // The same rule the /get-started form applies while typing: lowercase, letters, digits and underscore only. Availability and the 3-character minimum are the admin review's rules too.
      const candidate = text.toLowerCase().replace(/[^a-z0-9_]/g, "");
      if (candidate.length < 3) return stay(T.usernameShort);
      if (facts.usernameStatus === "taken") return stay(T.usernameTaken(candidate));
      d.username = candidate;
      const next = advance("ASK_OPERATOR");
      return { ...next, reply: `${facts.usernameStatus === "ok" ? `${T.usernameKept(candidate)}\n\n` : ""}${next.reply}` };
    }
    case "ASK_OPERATOR": {
      const medium: SignupMedium | null = n === 1 || has(t, ["mtn", "momo", "mtn mobile money", "mobile money"]) ? "mobile money" : n === 2 || has(t, ["orange", "orange money", "om"]) ? "orange money" : null;
      if (!medium) return confused();
      d.medium = medium;
      if (d.payPhone) {
        const seen = detectOperator(d.payPhone);
        if (seen && seen !== medium) return out("ASK_OPERATOR", { ...d, medium: undefined }, `${T.operatorMismatch(T.operatorName[seen])}\n\n${T.askOperator}`);
        return d.repay ? repay() : advance("REVIEW");
      }
      return out("ASK_PAY_PHONE", d, payPhonePrompt(lang, facts.waDigits));
    }
    case "ASK_PAY_PHONE": {
      const own = normalizeSignupPhone(facts.waDigits);
      const phone = n === 1 && own ? own : normalizeSignupPhone(text);
      if (!phone) return stay(T.payPhoneInvalid);
      const seen = detectOperator(phone);
      if (seen && d.medium && seen !== d.medium) {
        return out("ASK_OPERATOR", { ...d, payPhone: phone, medium: undefined }, `${T.operatorMismatch(T.operatorName[seen])}\n\n${T.askOperator}`);
      }
      d.payPhone = phone;
      return d.repay ? repay() : advance("REVIEW");
    }
    case "REVIEW": {
      if (!d.email) return out("ASK_EMAIL", { ...d, returnTo: "REVIEW" }, T.askEmail);
      if (n === 1) {
        if (!offerFor(facts, d.tier) || typeof facts.total !== "number") return stay(T.orderFailed);
        return out("CREATING", d, T.creating, "create_and_pay");
      }
      if (n === 2 || has(t, ["edit", "modifier", "change"])) return out("EDIT_MENU", d, T.editMenu);
      return confused();
    }
    case "EDIT_MENU": {
      if (n === 1) return out("ASK_NAME", { ...d, returnTo: "REVIEW" }, T.askName(offerFor(facts, d.tier) ? T.tierLabel[d.tier!] : ""));
      if (n === 2) return out("ASK_ADDRESS", { ...d, returnTo: "REVIEW" }, T.askAddress);
      if (n === 3) return out("ASK_EMAIL", { ...d, returnTo: "REVIEW" }, T.askEmail);
      if (n === 4) return out("ASK_USERNAME", { ...d, returnTo: "REVIEW" }, T.askUsername);
      if (n === 5) return out("ASK_OPERATOR", { ...d, returnTo: "REVIEW", payPhone: undefined, medium: undefined }, T.askOperator);
      if (n === 6) return out("CARDS", { ...d, returnTo: "REVIEW" }, cardsScreen(lang, facts));
      return confused();
    }
    case "PAYMENT": {
      if (has(t, ["status", "statut", "check", "verifier"])) return out("PAYMENT", d, T.creating, "check_payment");
      if (has(t, ["resend", "renvoyer"])) return out("PAYMENT", d, T.creating, "resend_payment");
      if (has(t, ["edit", "modifier", "change"])) return out("ASK_OPERATOR", { ...d, repay: true, payPhone: undefined, medium: undefined }, T.askOperator);
      return stay(T.paymentResumed);
    }
  }

  // The next question in the order. When one answer was changed from the review, go straight back to it.
  function advance(next: BotState): StepResult {
    if (d.returnTo === "REVIEW" && d.name && d.address && d.email && d.medium && d.payPhone) {
      d.returnTo = undefined;
      return out("REVIEW", d, prompt("REVIEW", d, facts, lang));
    }
    if (next === "ASK_OPERATOR" && d.returnTo === "REVIEW" && !d.medium) return out("ASK_OPERATOR", d, T.askOperator);
    if (next === "REVIEW" && !d.email) return out("ASK_EMAIL", d, T.askEmail);
    if (next === "REVIEW") d.returnTo = undefined;
    return out(next, d, prompt(next, d, facts, lang));
  }
  function repay(): StepResult { d.repay = undefined; return out("PAYMENT", d, T.creating, "resend_payment"); }
  function recommend(order: TierKey[]): StepResult {
    const pick = order.map((k) => offerFor(facts, k)).find(Boolean) ?? facts.offers[0];
    if (!pick) return out("CARDS", d, cardsScreen(lang, facts));
    d.tier = pick.tier;
    return out("CARD_DETAIL", d, `${T.recResult(T.tierLabel[pick.tier], money(lang, pick.priceXaf))}\n\n${detailScreen(lang, pick)}`);
  }
  return confused();
}
