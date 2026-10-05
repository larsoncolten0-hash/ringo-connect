// Business Toolkit Phase 3 (debtors, credit sales, reminders): the numbers every layer agrees on. The database re-enforces all of them
// (supabase/migrations/2026-12-03_debtors_reminders.sql); these exist so the UI and the pre-checks quote the same values.
export const REMINDER_DEFAULTS = { overdueEveryDays: 7, maxAutoPerInvoice: 3 } as const;
export const REMINDER_RANGES = { beforeDays: { min: 1, max: 14 }, overdueEveryDays: { min: 3, max: 60 }, maxAutoPerInvoice: { min: 1, max: 6 } } as const;
/** Platform limits (customer-directed emails). Automatic: 30 per business per day (all kinds counted). Manual: 24 h between emails of one invoice. */
export const REMINDER_LIMITS = { manualSpacingHours: 24, perInvoice: 10, autoDailyCap: 30, manualDailyCap: 100 } as const;
export const CONTACT_LIMITS = { name: 120, phone: 40, email: 200, notes: 500, address: 300 } as const;
/** The cron is dormant unless this environment variable is exactly "true". */
export const CRON_ENABLED_ENV = "INVOICE_REMINDERS_CRON_ENABLED";
export const REMINDER_CHANNELS = ["email", "whatsapp_manual"] as const;
export type ReminderChannel = (typeof REMINDER_CHANNELS)[number];
