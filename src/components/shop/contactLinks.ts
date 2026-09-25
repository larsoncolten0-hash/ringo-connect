// Phone links for the seller's order detail. Pure. Cameroon numbers are stored as the customer typed them
// after normalisation (usually the 9-digit national form); tel:/WhatsApp links need the country code.

const digitsOf = (phone: string) => phone.replace(/\D/g, "");

/** Digits with the Cameroon country code (237) added when the number is in the 9-digit national form. */
export function internationalDigits(phone: string): string {
  const d = digitsOf(phone);
  if (d.length === 9) return `237${d}`;
  return d;
}

export const telHref = (phone: string): string => `tel:+${internationalDigits(phone)}`;
export const whatsappHref = (phone: string): string => `https://wa.me/${internationalDigits(phone)}`;
