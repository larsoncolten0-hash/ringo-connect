import { translations } from "@/lib/i18n/translations";
import { formatDateKey, formatMoney, formatQuantityMilli } from "@/lib/documents/moneyFormat";
import type { DocumentModel } from "@/lib/documents/types";
import PrintButton from "./PrintButton";

// The customer's view of a shared invoice or receipt. A plain server component: no script, no account, no client state. It renders
// the stored snapshot in the language the document was issued in. It never shows internal ids; the only link is the PDF of this same
// token. Seller-recorded payments are labelled as recorded by the business, never as verified by Ringo. The only script is the Print button.
export default function PublicDocumentView({ model, pdfHref, logoHref = null }: { model: DocumentModel; pdfHref: string; logoHref?: string | null }) {
  const l = translations[model.locale === "en" ? "en" : "fr"].documents;
  const p = l.pdf;
  const money = (n: number) => formatMoney(n, model.currency, model.locale);
  const isReceipt = model.docType === "receipt";
  const sellerName = model.seller.name || model.seller.legalName;
  const party = (x: DocumentModel["seller"]) =>
    [
      x.legalName && x.legalName !== x.name ? x.legalName : null,
      x.address,
      x.phone,
      x.email,
      x.taxId ? `${p.taxId}: ${x.taxId}` : null,
      x.registrationNo ? `${p.registrationNo}: ${x.registrationNo}` : null,
    ].filter(Boolean) as string[];
  const balance = Math.max(0, model.totalMinor - model.amountPaidMinor);
  const sale = isReceipt && !!model.payment?.sale;
  const v2 = model.templateVersion >= 2;
  const accent = v2 && model.branding.accent ? model.branding.accent : null; // frozen at issue; a v1 document keeps its original look
  const pay = model.branding.paymentDetails;
  const payRows = pay ? ([[p.bankName, pay.bankName], [p.accountName, pay.accountName], [p.accountNumber, pay.accountNumber], [p.momoProvider, pay.momoProvider], [p.momoNumber, pay.momoNumber]] as [string, string | null][]).filter(([, x]) => x) : [];
  const showPay = v2 && !isReceipt && (model.status === "issued" || model.status === "partially_paid") && !!pay && (payRows.length > 0 || !!pay.instructions);

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-8 text-gray-900">
      <div className="mx-auto max-w-3xl">
        <p className="mb-3 text-center text-sm text-gray-500">{sellerName ? l.public.sharedNote(sellerName) : l.public.sharedNoteAnon}</p>
        <article className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm sm:p-8">
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {v2 && logoHref && <img src={logoHref} alt="" referrerPolicy="no-referrer" className="mb-2 max-h-14 max-w-[160px] object-contain" />}
              <h1 className="text-xl font-bold" style={accent ? { color: accent } : undefined}>{isReceipt ? p.receipt : p.invoice}</h1>
              <p className="mt-1 text-sm text-gray-600">{p.number} {model.number}</p>
            </div>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-semibold">{p.status[model.status] ?? model.status}</span>
          </header>

          {model.isVoid && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm font-medium text-red-700">{l.public.voidNotice}</p>}

          <dl className="mt-5 grid gap-1 text-sm sm:grid-cols-2">
            {model.issueDate && (
              <div><dt className="inline text-gray-500">{p.issueDate}: </dt><dd className="inline">{formatDateKey(model.issueDate, model.locale)}</dd></div>
            )}
            {!isReceipt && model.dueDate && (
              <div><dt className="inline text-gray-500">{p.dueDate}: </dt><dd className="inline">{formatDateKey(model.dueDate, model.locale)}</dd></div>
            )}
          </dl>

          <section className="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{p.from}</h2>
              <p className="mt-1 font-medium">{sellerName}</p>
              {party(model.seller).map((x, i) => <p key={i} className="text-sm text-gray-600">{x}</p>)}
            </div>
            {(!sale || model.customer.name) && (
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{p.billedTo}</h2>
                <p className="mt-1 font-medium">{model.customer.name}</p>
                {party(model.customer).map((x, i) => <p key={i} className="text-sm text-gray-600">{x}</p>)}
              </div>
            )}
          </section>

          {isReceipt && model.payment && !model.payment.sale ? (
            <section className="mt-6 rounded-xl bg-gray-50 p-4 text-sm">
              <p className="font-semibold">{p.paymentFor} {model.payment.invoiceNumber}</p>
              <dl className="mt-2 grid gap-1">
                <div><dt className="inline text-gray-500">{p.paymentDate}: </dt><dd className="inline">{formatDateKey(model.payment.paidOn, model.locale)}</dd></div>
                <div><dt className="inline text-gray-500">{p.paymentMethod}: </dt><dd className="inline">{p.methods[model.payment.method] ?? model.payment.method}</dd></div>
                {model.payment.reference && (
                  <div><dt className="inline text-gray-500">{p.reference}: </dt><dd className="inline">{model.payment.reference}</dd></div>
                )}
                <div><dt className="inline text-gray-500">{p.amountReceived}: </dt><dd className="inline font-semibold">{money(model.payment.amountMinor)}</dd></div>
                <div><dt className="inline text-gray-500">{p.balanceAfter}: </dt><dd className="inline">{money(model.payment.balanceAfterMinor)}</dd></div>
              </dl>
              <p className="mt-3 text-xs text-gray-500">{p.recordedByBusiness}</p>
            </section>
          ) : (
            <section className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[480px] text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                    <th className="py-2 pr-2">{p.description}</th>
                    <th className="py-2 pr-2 text-right">{p.quantity}</th>
                    <th className="py-2 pr-2 text-right">{p.unitPrice}</th>
                    <th className="py-2 text-right">{p.amount}</th>
                  </tr>
                </thead>
                <tbody>
                  {model.lines.map((ln) => (
                    <tr key={ln.position} className="border-b border-gray-100 align-top">
                      <td className="py-2 pr-2">{ln.description}</td>
                      <td className="py-2 pr-2 text-right">{formatQuantityMilli(ln.quantityMilli, model.locale)}</td>
                      <td className="py-2 pr-2 text-right">{money(ln.unitPriceMinor)}</td>
                      <td className="py-2 text-right">{money(ln.totalMinor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="ml-auto mt-4 grid max-w-xs gap-1 text-sm">
                <div className="flex justify-between"><dt className="text-gray-500">{p.subtotal}</dt><dd>{money(model.subtotalMinor)}</dd></div>
                {model.discountMinor > 0 && (
                  <div className="flex justify-between"><dt className="text-gray-500">{p.discount}</dt><dd>-{money(model.discountMinor)}</dd></div>
                )}
                {model.taxRateBp !== null && (
                  <div className="flex justify-between"><dt className="text-gray-500">{model.taxLabel || p.tax}</dt><dd>{money(model.taxMinor)}</dd></div>
                )}
                <div className="flex justify-between border-t border-gray-200 pt-1 font-semibold"><dt>{p.total}</dt><dd>{money(model.totalMinor)}</dd></div>
                {sale && model.payment ? (
                  <>
                    <div className="flex justify-between"><dt className="text-gray-500">{p.paymentMethod}</dt><dd>{p.methods[model.payment.method] ?? model.payment.method}</dd></div>
                    <div className="flex justify-between"><dt className="text-gray-500">{p.paymentDate}</dt><dd>{formatDateKey(model.payment.paidOn, model.locale)}</dd></div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between"><dt className="text-gray-500">{p.amountPaid}</dt><dd>{money(model.amountPaidMinor)}</dd></div>
                    <div className="flex justify-between font-semibold"><dt>{p.balanceDue}</dt><dd>{money(balance)}</dd></div>
                  </>
                )}
              </dl>
              {!sale && model.amountPaidMinor > 0 && <p className="mt-3 text-xs text-gray-500">{p.recordedByBusiness}</p>}
            </section>
          )}

          {showPay && pay && (
            <section className="mt-5 text-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{p.howToPay}</h2>
              <dl className="mt-1 grid gap-0.5">
                {payRows.map(([k, x]) => <div key={k}><dt className="inline text-gray-500">{k}: </dt><dd className="inline">{x}</dd></div>)}
              </dl>
              {pay.instructions && <p className="mt-1 whitespace-pre-line">{pay.instructions}</p>}
            </section>
          )}

          {model.notes && (
            <section className="mt-5 text-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{p.notes}</h2>
              <p className="mt-1 whitespace-pre-line">{model.notes}</p>
            </section>
          )}
          {model.terms && (
            <section className="mt-4 text-sm">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{p.terms}</h2>
              <p className="mt-1 whitespace-pre-line">{model.terms}</p>
            </section>
          )}

          <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap gap-2 print:hidden">
              <PrintButton label={l.ui.print} />
              <a href={pdfHref} rel="nofollow noreferrer" className="inline-flex min-h-[44px] items-center rounded-xl bg-gray-900 px-5 text-sm font-semibold text-white">
                {l.public.download}
              </a>
            </div>
            <p className="text-xs text-gray-500">{l.public.disclaimer}</p>
          </div>
        </article>
        {!v2 && <p className="mt-4 text-center text-xs text-gray-400">{p.generatedWith}</p>}
      </div>
    </main>
  );
}
