function normalizeAddressBookPhoneNumber(value) {
  const digits = String(value || "")
    .trim()
    .replace(/^wa2:(?:account-[^:]+:)?/i, "")
    .replace(/@.*$/, "")
    .replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    throw new Error("whatsapp2_contact_phone_unparseable");
  }
  return digits;
}

function splitContactName(value, fallback) {
  const parts = String(value || fallback || "Contato Tinder")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  return {
    firstName: parts[0] || "Contato Tinder",
    lastName: parts.slice(1).join(" "),
  };
}

async function saveWhatsApp2AddressBookContact(params) {
  const client = params?.client;
  if (typeof client?.saveOrEditAddressbookContact !== "function") {
    throw new Error("whatsapp2_address_book_api_unavailable");
  }

  const phoneNumber = normalizeAddressBookPhoneNumber(params.phoneNumber);
  const { firstName, lastName } = splitContactName(params.contactName, phoneNumber);
  await client.saveOrEditAddressbookContact(phoneNumber, firstName, lastName, false);
  return { phoneNumber, firstName, lastName };
}

module.exports = {
  normalizeAddressBookPhoneNumber,
  splitContactName,
  saveWhatsApp2AddressBookContact,
};
