// Maps an API error code to the key of a translated message in t.receivables.errors. A code with no mapping returns null so the caller can
// fall back to the Phase 2 mapping (documents.ui.errors) and finally "generic": a raw machine code is never shown to a person.
const MAP: Record<string, string> = {
  receivables_unavailable: "unavailable", documents_unavailable: "unavailable",
  customer_not_found: "customerNotFound", customer_archived: "customerArchived", duplicate_customer: "duplicateCustomer",
  invalid_customer_name: "invalidName", invalid_phone: "invalidPhone", invalid_email: "invalidEmail", invalid_notes: "invalidNotes", invalid_address: "invalidAddress",
  invalid_setting: "invalidSetting", business_email_required: "businessEmailRequired", no_reminder_timing: "noReminderTiming",
  invoice_not_open: "invoiceNotOpen", nothing_due: "nothingDue", no_email: "noEmail", email_suppressed: "emailSuppressed", no_phone: "noPhone",
  reminder_too_soon: "reminderTooSoon", invoice_reminder_cap: "invoiceReminderCap", daily_cap_reached: "dailyCapReached",
  share_link_invalid: "shareLinkInvalid", invalid_share_link: "shareLinkInvalid", email_failed: "emailFailed",
  not_an_invoice: "invoiceNotOpen", invalid_channel: "invalidSetting",
};

export function recvErrorKey(code: unknown): string | null {
  return typeof code === "string" && MAP[code] ? MAP[code] : null;
}
