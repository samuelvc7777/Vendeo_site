import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  normalizeAddressBookPhoneNumber,
  saveWhatsApp2AddressBookContact,
} = require("../services/whatsapp2-gateway/contact-address-book.cjs");

test("salva número E.164 no catálogo do WhatsApp com o nome do contato sem alterar a agenda do aparelho", async () => {
  let savedArgs = null;
  const result = await saveWhatsApp2AddressBookContact({
    client: {
      async saveOrEditAddressbookContact(...args) {
        savedArgs = args;
      },
    },
    phoneNumber: "+55 (11) 97777-6666@c.us",
    contactName: "Amanda Souza",
  });

  assert.deepEqual(savedArgs, ["5511977776666", "Amanda", "Souza", false]);
  assert.deepEqual(result, {
    phoneNumber: "5511977776666",
    firstName: "Amanda",
    lastName: "Souza",
  });
});

test("recusa formato não telefônico antes de chamar a API do WhatsApp", async () => {
  let called = false;
  await assert.rejects(
    () => saveWhatsApp2AddressBookContact({
      client: { async saveOrEditAddressbookContact() { called = true; } },
      phoneNumber: "não é um telefone",
      contactName: "Amanda",
    }),
    /whatsapp2_contact_phone_unparseable/,
  );
  assert.equal(called, false);
  assert.equal(normalizeAddressBookPhoneNumber("wa2:+5511977776666@c.us"), "5511977776666");
});
