// Rendering of a Watchdog finding into text, in English or French, from the rule code + its few safe params. The text is never stored: it is rendered when shown or
// sent, so a wording change needs no data change and the stored row can never hold a message that leaks something.
import { translations, type Locale } from "@/lib/i18n/translations";
import type { WatchdogParams, WatchdogRuleCode, WatchdogSeverity } from "./rules";

type Copy = (typeof translations)["en"]["watchdog"];

function localizedParams(copy: Copy, params: WatchdogParams): Record<string, string | number> {
  const out: Record<string, string | number> = { ...params };
  if (typeof params.program === "string" && params.program in copy.programs) out.program = (copy.programs as Record<string, string>)[params.program];
  if (typeof params.category === "string" && params.category in copy.categories) out.category = (copy.categories as Record<string, string>)[params.category];
  return out;
}

export function renderWatchdogAlert(locale: Locale, rule: WatchdogRuleCode, severity: WatchdogSeverity, params: WatchdogParams): { title: string; body: string; ruleTitle: string } {
  const copy = translations[locale].watchdog;
  const r = (copy.rules as Record<string, { title: string; body: (p: Record<string, any>) => string }>)[rule];
  const sev = copy.severity[severity] ?? severity;
  return { title: copy.alertTitle(sev), ruleTitle: r?.title ?? rule, body: r ? r.body(localizedParams(copy, params)) : rule };
}

/** The owner notification: ONE message carrying English and French (the platform keeps no per-admin language, same convention as the payout-destination notice). */
export function renderBilingualWatchdogAlert(rule: WatchdogRuleCode, severity: WatchdogSeverity, params: WatchdogParams): { title: string; body: string } {
  const en = renderWatchdogAlert("en", rule, severity, params);
  const fr = renderWatchdogAlert("fr", rule, severity, params);
  return { title: `${en.title} / ${fr.title}`, body: `${en.body}\n${fr.body}` };
}
