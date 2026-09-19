"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Coins, Gift, Loader2, Package, Receipt, Scissors, ShoppingBag } from "lucide-react";
import { useLanguage } from "@/components/LanguageProvider";
import type { ProgramRow } from "@/lib/loyalty/programs";
import type { LoyaltyActionKey, LoyaltyProgramType } from "@/lib/loyalty/categories";
import { actionText, api, codeOf, fmtMoney, outcomeText } from "@/components/loyalty/format";

type Options = { actions: LoyaltyActionKey[]; programTypes: LoyaltyProgramType[]; packages: boolean };
type Mode = { kind: "pick" } | { kind: "create"; type: LoyaltyProgramType } | { kind: "edit"; id: string };

const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-ringo-indigo px-4 py-2.5 text-sm font-semibold text-white transition active:scale-[0.98] disabled:opacity-50";
const btnGhost = "inline-flex items-center justify-center gap-1.5 rounded-xl border border-ringo-border px-3 py-2 text-sm font-medium text-ringo-text disabled:opacity-50";
const inputCls = "w-full rounded-xl border border-ringo-border bg-ringo-bg px-3 py-2.5 text-sm text-ringo-text focus:outline-none focus:ring-2 focus:ring-ringo-indigo/30";

// Which wording family the "count" program uses for this business (Visit / Service / Purchase
// Rewards). Pure presentation: the engine underneath is the same for all of them.
const SERVICE = new Set(["haircut", "treatment", "styling", "service", "booking"]);
const PURCHASE = new Set(["purchase", "ticket", "merch"]);

const toInt = (v: string): number | null => (/^\d+$/.test(v.trim()) && Number(v) > 0 ? Number(v) : null);

export default function ProgramSetup({
  programs,
  options,
  profileCurrency,
}: {
  programs: ProgramRow[];
  options: Options;
  profileCurrency: string | null;
}) {
  const { t, locale } = useLanguage();
  const L = t.loyalty;
  const router = useRouter();
  const [mode, setMode] = useState<Mode>({ kind: "pick" });
  const [showPicker, setShowPicker] = useState(programs.length === 0);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const variant = SERVICE.has(options.actions[0]) ? "service" : PURCHASE.has(options.actions[0]) ? "purchase" : "visit";
  const visitTitle = variant === "service" ? L.setup.serviceTitle : variant === "purchase" ? L.setup.purchaseTitle : L.setup.visitTitle;
  const visitBody = variant === "service" ? L.setup.serviceBody : variant === "purchase" ? L.setup.purchaseBody : L.setup.visitBody;
  const VisitIcon = variant === "service" ? Scissors : variant === "purchase" ? ShoppingBag : Gift;

  function done(text: string) {
    setNotice({ kind: "ok", text });
    setMode({ kind: "pick" });
    setShowPicker(false);
    router.refresh();
  }

  const editing = mode.kind === "edit" ? programs.find((p) => p.id === mode.id) ?? null : null;

  return (
    <div className="flex flex-col gap-5">
      {notice && (
        <p role="status" className={`rounded-xl px-4 py-3 text-sm font-medium ${notice.kind === "ok" ? "bg-emerald-500/10 text-emerald-600" : "bg-red-500/10 text-red-500"}`}>
          {notice.text}
        </p>
      )}

      {programs.length > 0 && mode.kind !== "edit" && (
        <section className="flex flex-col gap-2 rounded-card border border-ringo-border/70 bg-ringo-surface p-4">
          <h2 className="text-sm font-semibold text-ringo-text">{programs.length === 1 ? L.overview.yourProgram : L.overview.yourPrograms}</h2>
          {programs.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 border-b border-ringo-border/50 py-2 last:border-0">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ringo-text">
                  {p.name}
                  {!p.active && <span className="ml-2 rounded-full bg-ringo-muted/15 px-2 py-0.5 text-[10px] font-semibold text-ringo-muted">{L.overview.paused}</span>}
                </p>
                <p className="truncate text-xs text-ringo-muted">
                  {p.type === "spend"
                    ? L.overview.summarySpend(fmtMoney(p.target, p.currency, locale), p.reward_title)
                    : p.type === "points"
                    ? L.overview.summaryPoints(p.target, p.reward_title)
                    : L.overview.summaryVisits(p.target, actionText(L, p.action_key).many, p.reward_title)}
                </p>
              </div>
              <button type="button" className={btnGhost} onClick={() => { setNotice(null); setMode({ kind: "edit", id: p.id }); }}>
                {L.setup.edit}
              </button>
            </div>
          ))}
          {!showPicker && (
            <button type="button" className={`${btnGhost} mt-2 self-start`} onClick={() => setShowPicker(true)}>
              {L.setup.addAnother}
            </button>
          )}
        </section>
      )}

      {editing && (
        <ProgramForm
          key={editing.id}
          existing={editing}
          type={editing.type}
          options={options}
          profileCurrency={profileCurrency}
          onDone={done}
          onCancel={() => setMode({ kind: "pick" })}
          setNotice={setNotice}
        />
      )}

      {mode.kind === "pick" && showPicker && (
        <section className="flex flex-col gap-3">
          <h2 className="text-base font-semibold text-ringo-text">{L.setup.chooseTitle}</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {options.programTypes.includes("visits") && (
              <TypeCard icon={<VisitIcon size={20} />} title={visitTitle} body={visitBody} onClick={() => setMode({ kind: "create", type: "visits" })} />
            )}
            {options.programTypes.includes("spend") && (
              <TypeCard icon={<Receipt size={20} />} title={L.setup.spendTitle} body={L.setup.spendBody} onClick={() => setMode({ kind: "create", type: "spend" })} />
            )}
            {options.programTypes.includes("points") && (
              <TypeCard icon={<Coins size={20} />} title={L.setup.pointsTitle} body={L.setup.pointsBody} onClick={() => setMode({ kind: "create", type: "points" })} />
            )}
            {options.packages && (
              <Link href="/dashboard/loyalty/packages" className="flex items-start gap-3 rounded-card border border-ringo-border/70 bg-ringo-surface p-4 transition hover:border-ringo-indigo/40">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ringo-indigo/10 text-ringo-indigo">
                  <Package size={20} />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ringo-text">{L.setup.packagesTitle}</span>
                  <span className="block text-xs text-ringo-muted">{L.setup.packagesBody}</span>
                </span>
              </Link>
            )}
          </div>
        </section>
      )}

      {mode.kind === "create" && (
        <ProgramForm
          key={mode.type}
          existing={null}
          type={mode.type}
          options={options}
          profileCurrency={profileCurrency}
          onDone={done}
          onCancel={() => setMode({ kind: "pick" })}
          setNotice={setNotice}
        />
      )}
    </div>
  );
}

function TypeCard({ icon, title, body, onClick }: { icon: React.ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-start gap-3 rounded-card border border-ringo-border/70 bg-ringo-surface p-4 text-left transition hover:border-ringo-indigo/40">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ringo-indigo/10 text-ringo-indigo">{icon}</span>
      <span>
        <span className="block text-sm font-semibold text-ringo-text">{title}</span>
        <span className="block text-xs text-ringo-muted">{body}</span>
      </span>
    </button>
  );
}

function ProgramForm({
  existing,
  type,
  options,
  profileCurrency,
  onDone,
  onCancel,
  setNotice,
}: {
  existing: ProgramRow | null;
  type: LoyaltyProgramType;
  options: Options;
  profileCurrency: string | null;
  onDone: (text: string) => void;
  onCancel: () => void;
  setNotice: (n: { kind: "ok" | "error"; text: string } | null) => void;
}) {
  const { t } = useLanguage();
  const L = t.loyalty;
  const isEdit = !!existing;

  const [action, setAction] = useState<string>(existing?.action_key ?? options.actions[0]);
  const [target, setTarget] = useState(existing ? String(existing.target) : type === "visits" ? "10" : "");
  const [reward, setReward] = useState(existing?.reward_title ?? (type === "visits" ? actionText(L, options.actions[0]).reward : ""));
  const [rewardTouched, setRewardTouched] = useState(isEdit);
  const [expiryMode, setExpiryMode] = useState<"none" | "days">(existing?.reward_expires_days ? "days" : "none");
  const [days, setDays] = useState(existing?.reward_expires_days ? String(existing.reward_expires_days) : "30");
  const [unit, setUnit] = useState(existing?.unit_amount ? String(existing.unit_amount) : "1000");
  const [per, setPer] = useState(existing?.points_per_unit ? String(existing.points_per_unit) : "1");
  const [currency, setCurrency] = useState("");
  const [busy, setBusy] = useState(false);

  const validCurrency = !!profileCurrency && /^[A-Za-z]{3}$/.test(profileCurrency);
  const needsCurrency = !isEdit && type !== "visits" && !validCurrency;
  const shownCurrency = existing?.currency ?? (validCurrency ? profileCurrency!.toUpperCase() : currency.toUpperCase());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const targetN = toInt(target);
    const days_ = expiryMode === "days" ? toInt(days) : null;
    if (!targetN || !reward.trim() || (expiryMode === "days" && !days_)) return setNotice({ kind: "error", text: L.outcomes.invalid_request });
    if (type === "points" && (!toInt(unit) || !toInt(per))) return setNotice({ kind: "error", text: L.outcomes.invalid_request });
    if (needsCurrency && !/^[A-Za-z]{3}$/.test(currency)) return setNotice({ kind: "error", text: L.outcomes.currency_missing });

    setBusy(true);
    setNotice(null);
    const common = { target: targetN, reward_title: reward.trim(), reward_expires_days: days_ };
    const res = isEdit
      ? await api(`/api/loyalty/programs/${existing!.id}`, {
          method: "PATCH",
          body: { ...common, ...(type === "points" ? { unit_amount: toInt(unit), points_per_unit: toInt(per) } : {}) },
        })
      : await api("/api/loyalty/programs", {
          body: {
            ...common,
            type,
            ...(type === "visits" ? { action_key: action } : {}),
            ...(type === "points" ? { unit_amount: toInt(unit), points_per_unit: toInt(per) } : {}),
            ...(needsCurrency ? { currency: currency.toUpperCase() } : {}),
          },
        });
    setBusy(false);
    if (res.status === 200 || res.status === 201) return onDone(L.setup.saved);
    setNotice({ kind: "error", text: res.status === 0 ? L.scan.network : outcomeText(L, codeOf(res)) });
  }

  async function toggleActive() {
    if (!existing || busy) return;
    setBusy(true);
    setNotice(null);
    const res = await api(`/api/loyalty/programs/${existing.id}`, { method: "PATCH", body: { active: !existing.active } });
    setBusy(false);
    if (res.status === 200) return onDone(L.setup.saved);
    setNotice({ kind: "error", text: res.status === 0 ? L.scan.network : outcomeText(L, codeOf(res)) });
  }

  const title = type === "spend" ? L.setup.spendTitle : type === "points" ? L.setup.pointsTitle : L.setup.title;
  const targetLabel = type === "spend" ? L.setup.spendTargetLabel : type === "points" ? L.setup.pointsTargetLabel : actionText(L, action).howMany;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 rounded-card border border-ringo-indigo/30 bg-ringo-indigo/[0.03] p-5">
      <h2 className="text-base font-semibold text-ringo-text">{isEdit ? existing!.name : title}</h2>

      {type === "visits" && (
        <label className="flex flex-col gap-1 text-xs font-medium text-ringo-muted">
          {L.setup.actionLabel}
          <select
            value={action}
            disabled={isEdit}
            onChange={(e) => {
              setAction(e.target.value);
              if (!rewardTouched) setReward(actionText(L, e.target.value).reward);
            }}
            className={inputCls}
          >
            {options.actions.map((a) => (
              <option key={a} value={a}>
                {actionText(L, a).one}
              </option>
            ))}
          </select>
        </label>
      )}

      {type === "points" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-xs font-medium text-ringo-muted">
            {L.setup.pointsUnitLabel} {shownCurrency && `(${shownCurrency})`}
            <input inputMode="numeric" value={unit} onChange={(e) => setUnit(e.target.value.replace(/\D/g, ""))} className={inputCls} />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ringo-muted">
            {L.setup.pointsPerLabel}
            <input inputMode="numeric" value={per} onChange={(e) => setPer(e.target.value.replace(/\D/g, ""))} className={inputCls} />
          </label>
          <p className="text-xs text-ringo-muted sm:col-span-2">{L.setup.pointsNote}</p>
        </div>
      )}

      <label className="flex flex-col gap-1 text-xs font-medium text-ringo-muted">
        {targetLabel} {type === "spend" && shownCurrency ? `(${shownCurrency})` : ""}
        <input inputMode="numeric" value={target} onChange={(e) => setTarget(e.target.value.replace(/\D/g, ""))} className={inputCls} />
      </label>

      {needsCurrency && (
        <label className="flex flex-col gap-1 text-xs font-medium text-ringo-muted">
          {L.setup.currencyLabel}
          <input value={currency} maxLength={3} onChange={(e) => setCurrency(e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase())} placeholder="XAF" className={inputCls} />
        </label>
      )}

      <label className="flex flex-col gap-1 text-xs font-medium text-ringo-muted">
        {L.setup.rewardTitleLabel}
        <input
          value={reward}
          maxLength={120}
          onChange={(e) => {
            setReward(e.target.value);
            setRewardTouched(true);
          }}
          placeholder={type === "visits" ? actionText(L, action).reward : ""}
          className={inputCls}
        />
      </label>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-xs font-medium text-ringo-muted">{L.setup.expiryLabel}</legend>
        <label className="flex items-center gap-2 text-sm text-ringo-text">
          <input type="radio" name="expiry" checked={expiryMode === "none"} onChange={() => setExpiryMode("none")} /> {L.setup.expiryNone}
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm text-ringo-text">
          <input type="radio" name="expiry" checked={expiryMode === "days"} onChange={() => setExpiryMode("days")} /> {L.setup.expiryDays}
          {expiryMode === "days" && (
            <input aria-label={L.setup.daysLabel} inputMode="numeric" value={days} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} className="w-20 rounded-xl border border-ringo-border bg-ringo-bg px-2 py-1.5 text-sm" />
          )}
        </label>
      </fieldset>

      {isEdit && <p className="text-xs text-ringo-muted">{L.setup.immutableNote}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? <><Loader2 size={15} className="animate-spin" /> {L.setup.saving}</> : isEdit ? L.setup.save : L.setup.activate}
        </button>
        <button type="button" onClick={onCancel} className={btnGhost} disabled={busy}>
          {L.setup.cancel}
        </button>
        {isEdit && (
          <button type="button" onClick={toggleActive} className={`${btnGhost} ml-auto`} disabled={busy}>
            {existing!.active ? L.setup.pause : L.setup.resume}
          </button>
        )}
      </div>
    </form>
  );
}
