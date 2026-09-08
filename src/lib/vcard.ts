// Builds a vCard (.vcf) so a visitor can save this profile straight to
// their phone's own Contacts app instead of retyping the name and number
// by hand. vCard 3.0 is used over 4.0 because it's the version both
// iOS/macOS Contacts and Android's contact importer parse most reliably.
export function buildVCard(profile: any, pageUrl?: string): string {
  const escape = (s: string) =>
    String(s)
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");

  const name = profile?.name?.trim() || "Contact";
  const nameParts = name.split(/\s+/);
  const firstName = nameParts[0] || "";
  const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "";

  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${escape(name)}`,
    // N is only required for some Android parsers to file the contact
    // correctly — FN alone already satisfies iOS/macOS Contacts.
    `N:${escape(lastName)};${escape(firstName)};;;`,
  ];

  if (profile?.about_position) lines.push(`TITLE:${escape(profile.about_position)}`);
  if (profile?.about_company) lines.push(`ORG:${escape(profile.about_company)}`);

  // Dedupe: the WhatsApp number and the "about" phone are very often the
  // same number, and a contact with one phone listed twice looks broken.
  const phones = new Set<string>();
  if (profile?.whatsapp_number) phones.add(String(profile.whatsapp_number).trim());
  if (profile?.about_phone) phones.add(String(profile.about_phone).trim());
  for (const p of profile?.profile_phone_numbers || []) {
    if (p?.phone_number?.trim()) phones.add(p.phone_number.trim());
  }
  for (const phone of phones) {
    lines.push(`TEL;TYPE=CELL:${escape(phone)}`);
  }

  if (profile?.about_email) lines.push(`EMAIL:${escape(profile.about_email)}`);
  if (profile?.about_location) lines.push(`ADR;TYPE=WORK:;;${escape(profile.about_location)};;;;`);
  if (pageUrl) lines.push(`URL:${escape(pageUrl)}`);

  lines.push("END:VCARD");
  return lines.join("\r\n");
}

export function vCardFileName(profile: any): string {
  const base = (profile?.name || "contact").trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
  return `${base || "contact"}.vcf`;
}
