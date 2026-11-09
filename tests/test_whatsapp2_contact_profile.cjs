const assert = require("node:assert/strict");
const { test } = require("node:test");
const { contactProfile } = require("../services/whatsapp2-gateway/contact-profile.cjs");

function fixture(action, overrides = {}) {
  const phone = "5511987654321";
  const chatId = "5511999999999@c.us";
  const chat = {
    isGroup: false, isMuted: false,
    getContact: async () => ({ getAbout: async () => "Olá" }),
  };
  const active = {
    getChatById: async () => chat,
    getCommonGroups: async () => [{ _serialized: "123@g.us" }],
    getChats: async () => [{ id: { _serialized: "123@g.us" }, name: "Equipe" }],
  };
  return {
    chat, active,
    args: {
      input: { chatId, phone, ...overrides }, action, identity: () => phone,
      ensureReady: () => active, blockedIds: async () => new Set([chatId]),
    },
  };
}

test("consulta o recado, o bloqueio e os nomes dos grupos em comum", async () => {
  const { args } = fixture(null);
  assert.deepEqual(await contactProfile(args), {
    about: "Olá", isMuted: false, isBlocked: true, groups: ["Equipe"], participants: null,
  });
});

test("impede a mutação quando a sessão muda durante a consulta da conversa", async () => {
  const { args, chat, active } = fixture("mute", { hours: 8 });
  let phone = args.input.phone;
  args.identity = () => phone;
  active.getChatById = async () => {
    phone = "5511888888888";
    return chat;
  };
  chat.mute = () => assert.fail("chamada feita na conta errada");
  await assert.rejects(contactProfile(args), { statusCode: 409 });
});

test("silencia por uma duração válida e exige confirmação do provedor", async () => {
  const { args, chat } = fixture("mute", { hours: 8 });
  chat.mute = async until => {
    assert.ok(until.getTime() > Date.now());
    return { isMuted: true };
  };
  assert.deepEqual(await contactProfile(args), { isMuted: true });
  chat.mute = async () => ({ isMuted: false });
  await assert.rejects(contactProfile(args), { statusCode: 502 });
});
