import { translations } from "@/lib/i18n/translations";
import { detectOperator, normalizeSignupPhone, type SignupMedium } from "@/lib/signupPaymentClient";
import type { Offer, TierKey } from "./offers";

// The Smart Card sales bot as a PURE state machine: (session, customer text, facts) -> (new session, ONE reply, at most one effect). No database, no network, no clock,
// no AI. Every sentence comes from translations.<lang>.inbox.salesBot (EN + FR); every price and subscription line comes from the resolved add-on offers passed in as facts.
// The runner (runner.ts) owns everything with a side effect: persistence, the signup request, the payment request, the human hand-off notice.

export type BotState =
  | "WELCOME" | "CARDS" | "COMPARE" | "CARD_DETAIL" | "HOW_IT_WORKS" | "FAQ" | "RECOMMEND_1" | "RECOMMEND_2"
  | "ASK_NAME" | "ASK_ADDRESS" | "ASK_EMAIL" | "ASK_USERNAME" | "ASK_OPERATOR" | "ASK_PAY_PHONE" | "REVIEW" | "EDIT_MENU"
  | "CREATING" | "PAYMENT" | "COMPLETED" | "HUMAN_HANDOFF";
export const BOT_STATES: BotState[] = ["WELCOME", "CARDS", "COMPARE", "CARD_DETAIL", "HOW_IT_WORKS", "FAQ", "RECOMMEND_1", "RECOMMEND_2", "ASK_NAME", "ASK_ADDRESS", "ASK_EMAIL", "ASK_USERNAME", "ASK_OPERATOR", "ASK_PAY_PHONE", "REVIEW", "EDIT_MENU", "CREATING", "PAYMENT", "COMPLETED", "HUMAN_HANDOFF"];

/**
 * The database (wa_sales_sessions.state, wa_sales_save) already knows the states that existed when it was created, and is not altered for this feature. ASK_EMAIL is therefore stored as
 * ASK_ADDRESS with a small flag in the data, and restored on the way back in. These two functions are the ONLY place that knows about it.
 */
export function toStored(state: BotState, data: BotData): { state: BotState; data: BotData } {
  const { awaitEmail: _drop, ...rest } = data;
  return state === "ASK_EMAIL" ? { state: "ASK_ADDRESS", data: { ...rest, awaitEmail: true } } : { state, data: rest };
}
export function fromStored(state: BotState, data: BotData): { state: BotState; data: BotData } {
  const { awaitEmail, ...rest } = data;
  return state === "ASK_ADDRESS" && awaitEmail === true ? { state: "ASK_EMAIL", data: rest } : { state, data: rest };
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
  /** Storage detail for the e-mail step (see toStored / fromStored); never set by the machine itself. */
  awaitEmail?: boolean;
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
}
export type Effect = "none" | "handoff" | "create_and_pay" | "resend_payment" | "check_payment";
export interface StepResult { state: BotState; data: BotData; handoff: boolean; reply: string; effect: Effect }

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
const MENU_WORDS = ["0", "menu", "main menu", "menu principal", "start", "hi", "hello", "hey", "bonjour", "bonsoir", "salut", "hola"];
const CANCEL_WORDS = ["cancel", "reset", "restart", "annuler", "recommencer", "stop"];
const IMAGE_WORDS = ["image", "images", "photo", "photos", "picture", "pictures", "see image", "see images", "see the card", "voir image", "voir images", "voir les images", "voir des images", "voir la carte", "voir photo", "voir photos"];
const ORDER_WORDS = ["order", "buy", "i want to order", "commander", "acheter", "commande", "je veux commander"];
const SKIP_WORDS = ["skip", "no", "none", "passer", "non", "aucun", "pas besoin"];
const FREE_TEXT: BotState[] = ["ASK_NAME", "ASK_ADDRESS", "ASK_EMAIL", "ASK_USERNAME", "ASK_PAY_PHONE"];
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
function offerLines(lang: Lang, o: Offer): string[] {
  const T = S(lang);
  const lines = [T.subscription(T.period(o.days), cap(o.planName))];
  if (o.hasQr) lines.push(T.qrIncluded);
  if (o.hasConfig) lines.push(T.configIncluded);
  // What the granted plan itself includes (Basic or Pro), straight from the plans table; the other language is the fallback when one list is missing.
  const own = lang === "fr" ? o.featuresFr : o.featuresEn;
  lines.push(...(own.length ? own : lang === "fr" ? o.featuresEn : o.featuresFr));
  return lines;
}
const offerFor = (facts: Facts, tier?: TierKey) => facts.offers.find((o) => o.tier === tier);

// ------------------------------------------------------------------------------------------------ screens
function cardsScreen(lang: Lang, facts: Facts): string {
  const T = S(lang);
  if (facts.offers.length === 0) return T.unavailable;
  const body = facts.offers.map((o, i) => T.cardLine(i + 1, T.tierLabel[o.tier], money(lang, o.priceXaf), offerLines(lang, o))).join("");
  return `${T.cardsIntro}${body}${T.cardsFooter(facts.offers.length + 1, facts.offers.length + 2)}`;
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
  const lines = [...(all("hasQr") ? [T.qrIncluded] : []), ...(all("hasConfig") ? [T.configIncluded] : []), ...facts.offers.map((o) => `${T.tierLabel[o.tier]}: ${T.subscription(T.period(o.days), cap(o.planName))}`)];
  return T.faqIncluded(lines);
}
function reviewScreen(lang: Lang, d: BotData, facts: Facts, waDigits: string): string | null {
  const T = S(lang);
  const o = offerFor(facts, d.tier);
  if (!o || !d.name || !d.address || !d.email || !d.medium || !d.payPhone || typeof facts.total !== "number") return null;
  return T.review({ label: T.tierLabel[o.tier], price: money(lang, o.priceXaf), total: money(lang, facts.total), name: d.name, email: d.email, username: d.username || null, phone: `+${waDigits}`, address: d.address, operator: T.operatorName[d.medium], last3: lastDigits(d.payPhone) });
}
function payPhonePrompt(lang: Lang, waDigits: string): string {
  const own = normalizeSignupPhone(waDigits);
  return S(lang).askPayPhone(own ? lastDigits(own) : null);
}

function prompt(state: BotState, d: BotData, facts: Facts, lang: Lang): string {
  const T = S(lang);
  const o = offerFor(facts, d.tier);
  switch (state) {
    case "WELCOME": case "COMPLETED": case "HUMAN_HANDOFF": return T.welcome;
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
  const next: BotData = { lang: d.lang, tier: d.tier, ...(d.langLocked ? { langLocked: true } : {}) };
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
  const lang: Lang = signal ?? d.lang ?? "en";
  d.lang = lang;
  const T = S(lang);
  const out = (s: BotState, data: BotData, reply: string, effect: Effect = "none", handoff = false): StepResult => ({ state: s, data, handoff, reply, effect });
  const stay = (reply: string) => out(state, d, reply);
  const confused = () => stay(`${T.didNotUnderstand}\n\n${prompt(state, d, facts, lang)}`);
  const welcome = (prefix = "") => out("WELCOME", { lang, ...(d.langLocked ? { langLocked: true } : {}) }, `${prefix}${T.welcome}`);

  if (session.handoff || state === "HUMAN_HANDOFF") return { state: "HUMAN_HANDOFF", data: d, handoff: true, reply: "", effect: "none" };
  if (!t) return confused();

  // A human on request, at any point. Free-text answers (a name, an address) only match a bare request, never a word inside an address.
  const wantsHuman = FREE_TEXT.includes(state) ? has(t, HUMAN_WORDS) : HUMAN_LOOSE.test(t) || has(t, HUMAN_WORDS);
  if (wantsHuman) return out("HUMAN_HANDOFF", d, T.handoff, "handoff", true);

  // Language: any time, keeps the place in the conversation.
  if (has(t, ["fr", "francais", "french"]) || has(t, ["en", "english", "anglais"])) {
    const to: Lang = has(t, ["fr", "francais", "french"]) ? "fr" : "en";
    const nd = { ...d, lang: to, langLocked: true };
    const first = ORDER_FLOW.includes(state) || state === "PAYMENT" || state === "CREATING";
    return out(first ? state : "WELCOME", nd, `${S(to).langSwitched}\n\n${first ? prompt(state, nd, facts, to) : S(to).welcome}`);
  }

  if (state === "CREATING") {
    if (facts.stuck) return out("REVIEW", d, prompt("REVIEW", d, facts, lang));
    return stay(T.creating);
  }

  // 0 / menu / cancel: always works. Inside the order it clears the half-made order; nothing has been created or charged yet.
  if (has(t, MENU_WORDS) || has(t, CANCEL_WORDS)) {
    if (ORDER_FLOW.includes(state)) return welcome(`${T.cancelled}\n\n`);
    return welcome();
  }

  const n = choiceOf(t);

  switch (state) {
    case "WELCOME":
    case "COMPLETED": {
      if (n === 1 || has(t, ["cards", "cartes", "card", "carte", "see the cards", "voir les cartes", "price", "prix"])) return out("CARDS", d, cardsScreen(lang, facts));
      if (n === 2 || has(t, ["how it works", "comment ca marche", "how"])) return out("HOW_IT_WORKS", d, `${T.howItWorks}${T.howOptions}`);
      if (n === 3 || has(t, ["question", "questions", "faq"])) return out("FAQ", d, T.faqMenu);
      if (n === 4 || has(t, ORDER_WORDS)) return out("CARDS", d, cardsScreen(lang, facts));
      // Pictures: the official Ringo profile shows the card; the bot just points there (it never sends or invents images).
      if (n === 5 || has(t, IMAGE_WORDS)) return out(state === "COMPLETED" ? "COMPLETED" : "WELCOME", d, T.imagesInfo);
      if (n === 6) return out("HUMAN_HANDOFF", d, T.handoff, "handoff", true);
      return state === "COMPLETED" ? out("COMPLETED", d, T.afterPaid) : confused();
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
      if (n === 1 || has(t, ORDER_WORDS)) return out("CARDS", d, cardsScreen(lang, facts));
      if (n === 2) return out("CARDS", d, cardsScreen(lang, facts));
      if (n === 3) return out("FAQ", d, T.faqMenu);
      return confused();
    }
    case "FAQ": {
      if (has(t, ORDER_WORDS)) return out("CARDS", d, cardsScreen(lang, facts));
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
