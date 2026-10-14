import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const gateway = fs.readFileSync(
  new URL("../services/whatsapp2-gateway/index.cjs", import.meta.url),
  "utf8",
);
const ui = fs.readFileSync(
  new URL("../src/presentation/components/chat/InstagramDirect.tsx", import.meta.url),
  "utf8",
);
const client = fs.readFileSync(
  new URL("../src/presentation/components/chat/whatsapp2-client.ts", import.meta.url),
  "utf8",
);
const start = gateway.indexOf("async function resolveProfilePic(");
const end = gateway.indexOf("\nfunction warmProfilePics(", start);
assert.ok(start > 0 && end > start, "função de avatar encontrada");
const resolverSource = gateway.slice(start, end);

function resolverHarness({ cachedUrl, whatsappUrl }) {
  const chatId = "553299999999@c.us";
  const cache = new Map([[chatId, { url: cachedUrl, updatedAt: Date.now() }]]);
  const pending = new Map();
  const persisted = [];
  let providerCalls = 0;
  const context = {
    profilePicCache: cache,
    profilePicPending: pending,
    PROFILE_PIC_TTL_MS: 30 * 60 * 1000,
    ensureReady: () => ({
      getProfilePicUrl: async () => {
        providerCalls++;
        return whatsappUrl;
      },
    }),
    setProfilePicCacheEntry: (id, url) => cache.set(id, { url, updatedAt: Date.now() }),
    persistProfilePic: async (id, url) => persisted.push({ id, url }),
    console,
    Date,
  };
  const resolve = vm.runInNewContext(
    `${resolverSource}\nresolveProfilePic;`,
    context,
  );
  return { resolve, chatId, cache, pending, persisted, calls: () => providerCalls };
}

test("foto quebrada é atualizada mesmo antes do vencimento do cache", async () => {
  const oldUrl = "https://pps.whatsapp.net/old.jpg";
  const newUrl = "https://pps.whatsapp.net/new.jpg";
  const h = resolverHarness({ cachedUrl: oldUrl, whatsappUrl: newUrl });
  assert.equal(await h.resolve(h.chatId, { rejectedUrl: oldUrl }), newUrl);
  assert.equal(h.calls(), 1);
  assert.equal(h.cache.get(h.chatId).url, newUrl);
  assert.equal(h.persisted[0].url, newUrl);
});

test("se WhatsApp devolve a mesma URL quebrada, persiste avatar nulo", async () => {
  const oldUrl = "https://pps.whatsapp.net/old.jpg";
  const h = resolverHarness({ cachedUrl: oldUrl, whatsappUrl: oldUrl });
  assert.equal(await h.resolve(h.chatId, { rejectedUrl: oldUrl }), null);
  assert.equal(h.calls(), 1);
  assert.equal(h.cache.get(h.chatId).url, null);
  assert.equal(h.persisted[0].url, null);
});

test("URL já renovada por outra aba não dispara outra busca", async () => {
  const newUrl = "https://pps.whatsapp.net/new.jpg";
  const h = resolverHarness({ cachedUrl: newUrl, whatsappUrl: "unused" });
  assert.equal(
    await h.resolve(h.chatId, { rejectedUrl: "https://pps.whatsapp.net/old.jpg" }),
    newUrl,
  );
  assert.equal(h.calls(), 0);
});

test("interface tem fallback, retry limitado e endpoint de invalidação", () => {
  assert.match(ui, /refreshBrokenWhatsAppAvatar\(conversationId, rawSrc\)/);
  assert.match(ui, /alreadyRetried/);
  assert.match(ui, /attemptedWhatsAppAvatarRefreshes\.size > 600/);
  assert.match(client, /"\/chat\/profile\/refresh"/);
  assert.match(gateway, /req\.method === "POST" && url\.pathname === "\/chat\/profile\/refresh"/);
  assert.doesNotMatch(gateway, /if \(!getCachedProfilePic\(chatId\) && canonicalAvatar\)/);
});
