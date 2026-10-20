import type { WhatsAppStatusContact } from "./whatsapp2-client";

/** O WhatsApp envolve números sem nome em marcas invisíveis bidi (ex.: U+202A). */
export function normalizeStatusContactName(value: unknown): string {
  return String(value || "")
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "")
    .trim();
}

export function isNamedSavedStatusContact(contact: WhatsAppStatusContact): boolean {
  const name = normalizeStatusContactName(contact.name);
  const phone = String(contact.number || "").replace(/\D/g, "");
  if (contact.isMyContact !== true || !name || name === "...") return false;
  const nameDigits = name.replace(/\D/g, "");
  if (/^[+\d\s().-]+$/.test(name) && nameDigits.length >= 7) return false;
  if (nameDigits.length >= 7 && nameDigits === phone) return false;
  if (/^\d+@(c\.us|lid)$/i.test(name)) return false;
  return true;
}
