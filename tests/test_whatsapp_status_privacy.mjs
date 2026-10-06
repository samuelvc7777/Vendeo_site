import test from "node:test";
import assert from "node:assert/strict";
import {
  validatePrivacyPayload,
  VALID_PRIVACY_TYPES,
  WhatsAppStatusError,
  validateTextStatusPayload,
  prepareImageStatusData,
  getStatusPrivacy,
  setStatusPrivacy,
  getStatusContacts,
  applyStatusPrivacy,
} from "../services/whatsapp2-gateway/status/status-service.cjs";

test("1. validatePrivacyPayload - validações e aliases", () => {
  assert.equal(validatePrivacyPayload(null), null);
  assert.equal(validatePrivacyPayload(undefined), null);

  // Contatos (todos)
  const contactsRes = validatePrivacyPayload({ type: "contact" });
  assert.deepEqual(contactsRes, { type: "contact", list: [] });

  const contactsAliasRes = validatePrivacyPayload({ type: "contacts" });
  assert.deepEqual(contactsAliasRes, { type: "contact", list: [] });

  // Lista negra (exceto)
  const denyRes = validatePrivacyPayload({
    type: "deny-list",
    list: ["553299149414@c.us", "12345@lid"],
  });
  assert.deepEqual(denyRes, {
    type: "deny-list",
    list: ["553299149414@c.us", "12345@lid"],
  });

  const blacklistAliasRes = validatePrivacyPayload({
    type: "blacklist",
    list: ["553299149414@c.us"],
  });
  assert.deepEqual(blacklistAliasRes, {
    type: "deny-list",
    list: ["553299149414@c.us"],
  });

  // Lista branca (somente com)
  const allowRes = validatePrivacyPayload({
    type: "allow-list",
    list: ["553299149414@c.us"],
  });
  assert.deepEqual(allowRes, {
    type: "allow-list",
    list: ["553299149414@c.us"],
  });

  const whitelistAliasRes = validatePrivacyPayload({
    type: "whitelist",
    list: ["553299149414@c.us"],
  });
  assert.deepEqual(whitelistAliasRes, {
    type: "allow-list",
    list: ["553299149414@c.us"],
  });
});

test("2. validatePrivacyPayload - rejeita payloads inválidos", () => {
  assert.throws(
    () => validatePrivacyPayload("string-invalida"),
    (err) => err instanceof WhatsAppStatusError && err.code === "WHATSAPP2_INVALID_PRIVACY",
  );

  assert.throws(
    () => validatePrivacyPayload({ type: "tipo_inexistente" }),
    (err) => err instanceof WhatsAppStatusError && err.code === "WHATSAPP2_INVALID_PRIVACY_TYPE",
  );

  assert.throws(
    () => validatePrivacyPayload({ type: "deny-list", list: [] }),
    (err) => err instanceof WhatsAppStatusError && err.code === "WHATSAPP2_EMPTY_PRIVACY_LIST",
  );

  assert.throws(
    () => validatePrivacyPayload({ type: "allow-list", list: [] }),
    (err) => err instanceof WhatsAppStatusError && err.code === "WHATSAPP2_EMPTY_PRIVACY_LIST",
  );
});

test("3. Integração de privacy nos validadores de payload (texto e imagem)", async () => {
  const textPayload = validateTextStatusPayload({
    text: "Meu status privado",
    privacy: {
      type: "allow-list",
      list: ["553299149414@c.us"],
    },
  });
  assert.ok(textPayload.privacy);
  assert.equal(textPayload.privacy.type, "allow-list");
  assert.equal(textPayload.privacy.list[0], "553299149414@c.us");

  const tinyPngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const imagePayload = await prepareImageStatusData({
    mediaBase64: `data:image/png;base64,${tinyPngBase64}`,
    privacy: {
      type: "deny-list",
      list: ["99999@c.us"],
    },
  });
  assert.ok(imagePayload.privacy);
  assert.equal(imagePayload.privacy.type, "deny-list");
  assert.equal(imagePayload.privacy.list[0], "99999@c.us");
});

test("4. getStatusPrivacy e setStatusPrivacy com mock do Puppeteer", async () => {
  let appliedType = null;
  let appliedList = null;

  const mockPage = {
    evaluate: async (fn, arg) => {
      if (arg) {
        appliedType = arg.type;
        appliedList = arg.list;
        return { ok: true, type: arg.type, count: arg.list.length };
      }
      return {
        ok: true,
        type: "contact",
        list: [],
        count: 0,
      };
    },
  };

  const mockClient = { pupPage: mockPage };

  const getRes = await getStatusPrivacy({ client: mockClient });
  assert.equal(getRes.ok, true);
  assert.equal(getRes.type, "contact");

  const setRes = await setStatusPrivacy({
    client: mockClient,
    body: {
      type: "allow-list",
      list: ["553211111111@c.us", "553222222222@c.us"],
    },
  });
  assert.equal(setRes.ok, true);
  assert.equal(setRes.type, "allow-list");
  assert.equal(setRes.count, 2);
  assert.equal(appliedType, "allow-list");
  assert.deepEqual(appliedList, ["553211111111@c.us", "553222222222@c.us"]);
});

test("5. getStatusContacts formatação e ordenação", async () => {
  const mockContacts = [
    {
      id: "553299999999@c.us",
      name: "Ana Silva",
      number: "553299999999",
      avatarUrl: "https://avatar.test/ana.jpg",
      isMyContact: true,
    },
    {
      id: "553288888888@c.us",
      name: "Carlos Souza",
      number: "553288888888",
      avatarUrl: null,
      isMyContact: true,
    },
  ];

  const mockPage = {
    evaluate: async (fn, arg) => {
      const search = arg?.search;
      const limit = arg?.limit || 200;
      let filtered = mockContacts;
      if (search) {
        filtered = filtered.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()));
      }
      return filtered.slice(0, limit);
    },
  };

  const mockClient = { pupPage: mockPage };

  const resAll = await getStatusContacts({ client: mockClient });
  assert.equal(resAll.ok, true);
  assert.equal(resAll.total, 2);
  assert.equal(resAll.contacts[0].name, "Ana Silva");

  const resSearch = await getStatusContacts({ client: mockClient, search: "Carlos" });
  assert.equal(resSearch.ok, true);
  assert.equal(resSearch.total, 1);
  assert.equal(resSearch.contacts[0].name, "Carlos Souza");
});

test("6. applyStatusPrivacy usa LID nativo e confirma readback real", async () => {
  let appliedConfig = null;
  let appliedParticipants = null;
  let storedConfig = {
    setting: "allow-list",
    allowList: [],
    denyList: [],
  };

  const mockPage = {
    evaluate: async (fn, arg) => {
      const previousWPP = globalThis.WPP;
      const previousWindow = globalThis.window;

      globalThis.WPP = {
        isReady: true,
        contact: {
          getPnLidEntry: async (id) => {
            if (String(id).includes("553799980534") || String(id).includes("239324167671848")) {
              return {
                lid: { _serialized: "239324167671848@lid" },
                phoneNumber: { _serialized: "553799980534@c.us" },
              };
            }
            return null;
          },
        },
        status: {
          updateParticipants: async (ids) => {
            appliedParticipants = ids;
          },
        },
      };

      globalThis.window = {
        require: (name) => {
          if (name === "WAWebWidFactory") {
            return {
              createWid: (id) => ({ _serialized: id }),
            };
          }
          if (name === "WAWebUserPrefsStatus") {
            return {
              setStatusPrivacyConfig: async ({ setting, list }) => {
                appliedConfig = { setting, list };
                storedConfig = {
                  setting,
                  allowList: setting === "allow-list"
                    ? list.map((item) => item._serialized)
                    : [],
                  denyList: setting === "deny-list"
                    ? list.map((item) => item._serialized)
                    : [],
                };
              },
              getStatusPrivacySettingConfig: async () => storedConfig,
              getStatusContacts: async () => [
                { _serialized: "239324167671848@lid" },
              ],
            };
          }
          throw new Error(`unexpected module: ${name}`);
        },
      };

      try {
        return await fn(arg);
      } finally {
        globalThis.WPP = previousWPP;
        globalThis.window = previousWindow;
      }
    },
  };

  const result = await applyStatusPrivacy(mockPage, {
    type: "allow-list",
    list: ["553799980534@c.us"],
  });

  assert.equal(result.ok, true);
  assert.equal(result.type, "allow-list");
  assert.deepEqual(result.list, ["553799980534@c.us"]);
  assert.deepEqual(result.nativeList, ["239324167671848@lid"]);
  assert.equal(appliedConfig.setting, "allow-list");
  assert.deepEqual(
    appliedConfig.list.map((item) => item._serialized),
    ["239324167671848@lid"],
  );
  assert.deepEqual(appliedParticipants, ["239324167671848@lid"]);
});

test("7. applyStatusPrivacy bloqueia publicação se o WhatsApp não confirmar a audiência", async () => {
  const mockPage = {
    evaluate: async (fn, arg) => {
      const previousWPP = globalThis.WPP;
      const previousWindow = globalThis.window;

      globalThis.WPP = {
        isReady: true,
        contact: {
          getPnLidEntry: async (id) => {
            if (String(id).endsWith("@c.us")) {
              return {
                lid: { _serialized: "111111111111111@lid" },
                phoneNumber: { _serialized: String(id) },
              };
            }
            return {
              lid: { _serialized: String(id) },
              phoneNumber: { _serialized: "553211111111@c.us" },
            };
          },
        },
        status: {
          updateParticipants: async () => {},
        },
      };

      globalThis.window = {
        require: (name) => {
          if (name === "WAWebWidFactory") {
            return { createWid: (id) => ({ _serialized: id }) };
          }
          if (name === "WAWebUserPrefsStatus") {
            return {
              setStatusPrivacyConfig: async () => {},
              getStatusPrivacySettingConfig: async () => ({
                setting: "allow-list",
                allowList: ["999999999999999@lid"],
                denyList: [],
              }),
              getStatusContacts: async () => [],
            };
          }
          throw new Error(`unexpected module: ${name}`);
        },
      };

      try {
        return await fn(arg);
      } finally {
        globalThis.WPP = previousWPP;
        globalThis.window = previousWindow;
      }
    },
  };

  await assert.rejects(
    () => applyStatusPrivacy(mockPage, {
      type: "allow-list",
      list: ["553211111111@c.us"],
    }),
    (err) =>
      err instanceof WhatsAppStatusError
      && err.code === "WHATSAPP2_STATUS_PRIVACY_NOT_CONFIRMED",
  );
});
