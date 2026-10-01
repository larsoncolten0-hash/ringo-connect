// Which actions a document state allows. The single source of truth: the API returns these flags (so the UI never offers an action the
// database would refuse) and the list view derives the same flags from a row summary. The database remains the authority and
// re-checks every transition; this only decides what is OFFERED.
//
//   draft            edit · discard · issue                                  (no number exists yet)
//   issued           pdf · record payment · void (only while nothing is paid)
//   partially paid   pdf · record payment                                   (void its payments first to void the invoice)
//   paid             pdf                                                    (receipts are reachable from the payments list)
//   void             pdf (history) · create a corrected invoice (once, if it was ever issued and not yet replaced)
// Sharing (a secret view/download link) is offered while a document is live (issued, partially paid, paid; a receipt is `issued`).
// Never for a draft or a void document: the database refuses both. A link made earlier keeps working after a void and then shows the
// void status to the customer.
export type DocumentActions = {
  edit: boolean;
  discard: boolean;
  issue: boolean;
  recordPayment: boolean;
  void: boolean;
  pdf: boolean;
  share: boolean;
  correct: boolean;
};

export function documentActions(d: { docType: string; status: string; totalMinor: number; amountPaidMinor: number; wasIssued: boolean; replaced: boolean }): DocumentActions {
  const invoice = d.docType === "invoice";
  const balance = Math.max(0, d.totalMinor - d.amountPaidMinor);
  return {
    edit: invoice && d.status === "draft",
    discard: invoice && d.status === "draft",
    issue: invoice && d.status === "draft",
    recordPayment: invoice && (d.status === "issued" || d.status === "partially_paid") && balance > 0,
    void: invoice && d.status === "issued" && d.amountPaidMinor === 0,
    pdf: true,
    share: d.status === "issued" || d.status === "partially_paid" || d.status === "paid",
    correct: invoice && d.status === "void" && d.wasIssued && !d.replaced,
  };
}
