import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import { dispatchOutboundAction, sendTinderMessage, isTinderLiveDispatchEnabled } from "../supabase/functions/api/channel_dispatcher.ts";
import { handleTinderMatchRoutes } from "../supabase/functions/api/tinder_match_routes.ts";

test("dispatchOutboundAction para Tinder usa adaptador Tinder e nunca desvia para Meta Graph API", async () => {
  let tinderAdapterCalled = false;
  let instagramAdapterCalled = false;

  const mockDb = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { channel: "tinder" }, error: null }),
          }),
        }),
      };
    },
  };

  const outcome = await dispatchOutboundAction({
    supabase: mockDb,
    outboxEntry: {
      conversationId: "tinder:match_12345",
      channel: "tinder",
      messageType: "text",
      content: "Oi lindo!",
    },
    mockAdapters: {
      tinder: async (entry) => {
        tinderAdapterCalled = true;
        assert.equal(entry.content, "Oi lindo!");
        return { success: true, providerMessageId: "tinder_msg_999" };
      },
      instagram: async () => {
        instagramAdapterCalled = true;
        throw new Error("Meta Graph API NUNCA deve ser chamada para Tinder");
      },
    },
  });

  assert.equal(tinderAdapterCalled, true);
  assert.equal(instagramAdapterCalled, false);
  assert.equal(outcome.success, true);
  assert.equal(outcome.channelUsed, "tinder");
  assert.equal(outcome.providerMessageId, "tinder_msg_999");
});

test("dispatchOutboundAction para WhatsApp2 usa adaptador WhatsApp2", async () => {
  let waAdapterCalled = false;

  const mockDb = {
    from() {
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { channel: "whatsapp2" }, error: null }),
          }),
        }),
      };
    },
  };

  const outcome = await dispatchOutboundAction({
    supabase: mockDb,
    outboxEntry: {
      conversationId: "wa2:5511999998888@c.us",
      channel: "whatsapp2",
      messageType: "text",
      content: "Tudo bem por aí?",
    },
    mockAdapters: {
      whatsapp2: async (entry) => {
        waAdapterCalled = true;
        assert.equal(entry.content, "Tudo bem por aí?");
        return { success: true, providerMessageId: "wam_xyz_888" };
      },
    },
  });

  assert.equal(waAdapterCalled, true);
  assert.equal(outcome.success, true);
  assert.equal(outcome.channelUsed, "whatsapp2");
  assert.equal(outcome.providerMessageId, "wam_xyz_888");
});

test("chamadas reais ao Tinder são bloqueadas por padrão de segurança quando flag está desligada", async () => {
  const originalEnv = process.env.ENABLE_TINDER_LIVE_DISPATCH;
  delete process.env.ENABLE_TINDER_LIVE_DISPATCH;
  try {
    const outcome = await dispatchOutboundAction({
      supabase: {},
      outboxEntry: {
        conversationId: "tinder:match_12345",
        channel: "tinder",
        messageType: "text",
        content: "Oi!",
      },
    });

    assert.equal(outcome.success, false);
    assert.equal(outcome.channelUsed, "tinder");
    assert.match(outcome.error, /tinder_live_dispatch_blocked_pending_scope_validation/);
  } finally {
    if (originalEnv !== undefined) process.env.ENABLE_TINDER_LIVE_DISPATCH = originalEnv;
  }
});

test("flag de envio lê Deno.env no runtime Edge", () => {
  const originalDeno = globalThis.Deno;
  const originalEnv = process.env.ENABLE_TINDER_LIVE_DISPATCH;
  delete process.env.ENABLE_TINDER_LIVE_DISPATCH;
  globalThis.Deno = { env: { get: (name) => name === "ENABLE_TINDER_LIVE_DISPATCH" ? "true" : undefined } };
  try {
    assert.equal(isTinderLiveDispatchEnabled(), true);
  } finally {
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
    if (originalEnv !== undefined) process.env.ENABLE_TINDER_LIVE_DISPATCH = originalEnv;
  }
});

test("falha de token do Tinder retorna erro explícito sem fallback silencioso", async () => {
  const originalEnv = process.env.ENABLE_TINDER_LIVE_DISPATCH;
  process.env.ENABLE_TINDER_LIVE_DISPATCH = "true";
  try {
    const mockDb = {
      from(table) {
        if (table === "match_tinder_config") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: { api_token: null, is_active: false }, error: null }),
              }),
            }),
          };
        }
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { channel: "tinder" }, error: null }),
            }),
          }),
        };
      },
    };

    const outcome = await dispatchOutboundAction({
      supabase: mockDb,
      outboxEntry: {
        conversationId: "tinder:match_12345",
        channel: "tinder",
        messageType: "text",
        content: "Oi!",
      },
    });

    assert.equal(outcome.success, false);
    assert.equal(outcome.channelUsed, "tinder");
    assert.match(outcome.error, /tinder_token_not_configured_or_inactive/);
  } finally {
    if (originalEnv !== undefined) process.env.ENABLE_TINDER_LIVE_DISPATCH = originalEnv;
    else delete process.env.ENABLE_TINDER_LIVE_DISPATCH;
  }
});

test("dispatcher real reutiliza o auth_token e a rota de envio já usada pelo Match, com fetch simulado", async () => {
  const originalEnv = process.env.ENABLE_TINDER_LIVE_DISPATCH;
  const originalFetch = globalThis.fetch;
  process.env.ENABLE_TINDER_LIVE_DISPATCH = "true";
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("/v1/chat/channels/query")) {
      return new Response(JSON.stringify({
        channels: [{ channel_id: { id: "channel_123", reference_id: "match_12345" } }],
        pagination_info: { has_next_page: false },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.includes("/v1/chat/channels/messages?")) {
      return new Response(JSON.stringify({ message_id: { id: "provider_message_123" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`Endpoint inesperado no fetch simulado: ${url}`);
  };

  try {
    const mockDb = {
      from(table) {
        assert.equal(table, "match_tinder_config");
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { auth_token: "token-de-teste", user_id: "larissa" },
                error: null,
              }),
            }),
          }),
        };
      },
    };

    const result = await sendTinderMessage({
      supabase: mockDb,
      matchId: "match_12345",
      text: "Oi!",
    });

    assert.equal(result.success, true);
    assert.equal(result.providerMessageId, "provider_message_123");
    assert.equal(requests.filter((request) => request.url.includes("/v1/chat/channels/query")).length, 2);
    const sendRequest = requests.find((request) => request.url.includes("/v1/chat/channels/messages?"));
    assert.ok(sendRequest);
    assert.equal(sendRequest.init.headers["X-Auth-Token"], "token-de-teste");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalEnv !== undefined) process.env.ENABLE_TINDER_LIVE_DISPATCH = originalEnv;
    else delete process.env.ENABLE_TINDER_LIVE_DISPATCH;
  }
});

test("rotas protegidas do Match recusam sessão ausente antes de acessar o Tinder", async () => {
  const originalFetch = globalThis.fetch;
  let externalRequests = 0;
  globalThis.fetch = async () => {
    externalRequests += 1;
    throw new Error("A rota não deveria chamar o Tinder sem sessão válida.");
  };

  try {
    const mockDb = {
      from(table) {
        assert.equal(table, "match_tinder_config");
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { auth_token: "token-de-teste", session_hash: "hash-de-sessao-valida" },
                error: null,
              }),
            }),
          }),
        };
      },
    };
    const response = await handleTinderMatchRoutes({
      request: new Request("https://vendeo.test/api/match/tinder/matches"),
      path: "/match/tinder/matches",
      supabase: mockDb,
      corsHeaders: {},
      originAllowed: true,
    });

    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.code, "MATCH_SESSION_REQUIRED");
    assert.equal(externalRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("estado de IA do match informa flags desligadas sem ativar conversa", async () => {
  const originalDeno = globalThis.Deno;
  const originalSyncFlag = process.env.ENABLE_TINDER_LIVE_SYNC;
  const originalDispatchFlag = process.env.ENABLE_TINDER_LIVE_DISPATCH;
  delete process.env.ENABLE_TINDER_LIVE_SYNC;
  delete process.env.ENABLE_TINDER_LIVE_DISPATCH;
  globalThis.Deno = { env: { get: () => undefined } };
  const secret = "match-session-secret-test";
  const sessionHash = createHash("sha256").update(secret).digest("hex");

  try {
    const mockDb = {
      from(table) {
        if (table === "match_tinder_config") {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { auth_token: "token-de-teste", session_hash: sessionHash },
                  error: null,
                }),
              }),
            }),
          };
        }
        if (table === "conversation_channel_identities") {
          const query = {
            select: () => query,
            eq: () => query,
            order: () => query,
            limit: () => query,
            maybeSingle: async () => ({ data: null, error: null }),
          };
          return query;
        }
        if (table === "instagram_conversations") {
          return {
            select: () => ({
              eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
            }),
          };
        }
        throw new Error(`Tabela inesperada: ${table}`);
      },
    };
    const response = await handleTinderMatchRoutes({
      request: new Request("https://vendeo.test/api/match/tinder/ai/match_123", {
        headers: { "x-match-session": secret },
      }),
      path: "/match/tinder/ai/match_123",
      supabase: mockDb,
      corsHeaders: {},
      originAllowed: true,
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.found, false);
    assert.equal(payload.isEnabled, false);
    assert.deepEqual(payload.automation, { enabled: false, syncEnabled: false, dispatchEnabled: false });
  } finally {
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
    if (originalSyncFlag !== undefined) process.env.ENABLE_TINDER_LIVE_SYNC = originalSyncFlag;
    if (originalDispatchFlag !== undefined) process.env.ENABLE_TINDER_LIVE_DISPATCH = originalDispatchFlag;
  }
});

test("preparação da IA recusa sync real enquanto qualquer flag de operação estiver desligada", async () => {
  const originalDeno = globalThis.Deno;
  const originalSyncFlag = process.env.ENABLE_TINDER_LIVE_SYNC;
  const originalDispatchFlag = process.env.ENABLE_TINDER_LIVE_DISPATCH;
  const originalFetch = globalThis.fetch;
  delete process.env.ENABLE_TINDER_LIVE_SYNC;
  delete process.env.ENABLE_TINDER_LIVE_DISPATCH;
  globalThis.Deno = { env: { get: () => undefined } };
  let externalRequests = 0;
  globalThis.fetch = async () => {
    externalRequests += 1;
    throw new Error("Tinder não pode ser chamado enquanto as flags estiverem desligadas.");
  };
  const secret = "match-session-secret-test";
  const sessionHash = createHash("sha256").update(secret).digest("hex");

  try {
    const mockDb = {
      from(table) {
        assert.equal(table, "match_tinder_config");
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { auth_token: "token-de-teste", session_hash: sessionHash },
                error: null,
              }),
            }),
          }),
        };
      },
    };
    const response = await handleTinderMatchRoutes({
      request: new Request("https://vendeo.test/api/match/tinder/ai/match_123/prepare", {
        method: "POST",
        headers: { "x-match-session": secret, "content-type": "application/json" },
        body: JSON.stringify({ name: "Match" }),
      }),
      path: "/match/tinder/ai/match_123/prepare",
      supabase: mockDb,
      corsHeaders: {},
      originAllowed: true,
    });

    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, "TINDER_AUTOMATION_DISABLED");
    assert.equal(externalRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
    if (originalSyncFlag !== undefined) process.env.ENABLE_TINDER_LIVE_SYNC = originalSyncFlag;
    if (originalDispatchFlag !== undefined) process.env.ENABLE_TINDER_LIVE_DISPATCH = originalDispatchFlag;
  }
});

test("status do Tinder não revela perfil nem emite sessão quando o navegador não possui sessão válida", async () => {
  const originalFetch = globalThis.fetch;
  let tinderRequests = 0;
  globalThis.fetch = async () => {
    tinderRequests++;
    return new Response(JSON.stringify({ data: { user: { _id: "private-profile", name: "Perfil privado" } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const response = await handleTinderMatchRoutes({
      request: new Request("https://vendeo.test/api/match/tinder/status"),
      path: "/match/tinder/status",
      supabase: {
        from(table) {
          assert.equal(table, "match_tinder_config");
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    auth_token: "stored-tinder-token",
                    session_hash: "hash-owned-by-another-browser",
                    profile: { id: "private-profile", name: "Perfil privado" },
                  },
                  error: null,
                }),
              }),
            }),
          };
        },
      },
      corsHeaders: {},
      originAllowed: true,
    });

    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.connected, false);
    assert.equal(payload.serverHasConnection, true);
    assert.equal(payload.requiresSession, true);
    assert.equal("sessionSecret" in payload, false);
    assert.equal(payload.profile, null);
    assert.equal(tinderRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("reconectar recupera sessão com o mesmo token e impede substituir a conta conectada", async () => {
  const originalFetch = globalThis.fetch;
  let tinderRequests = 0;
  let config = {
    id: "default",
    auth_token: "the-existing-private-tinder-token",
    session_hash: "existing-session-hash",
    profile: null,
  };
  globalThis.fetch = async () => {
    tinderRequests++;
    return new Response(JSON.stringify({ data: { user: { _id: "account-1", name: "Conta atual" } } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const supabase = {
      from(table) {
        assert.equal(table, "match_tinder_config");
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: config, error: null }) }),
          }),
          upsert: async (row) => { config = { ...row }; return { error: null }; },
        };
      },
    };
    const makeRequest = (token) => new Request("https://vendeo.test/api/match/tinder/connect", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    });

    const recovery = await handleTinderMatchRoutes({
      request: makeRequest("the-existing-private-tinder-token"),
      path: "/match/tinder/connect",
      supabase,
      corsHeaders: {},
      originAllowed: true,
    });
    assert.equal(recovery.status, 200);
    const recoveryPayload = await recovery.json();
    assert.equal(recoveryPayload.connected, true);
    assert.equal(config.auth_token, "the-existing-private-tinder-token");
    assert.equal(config.session_hash, createHash("sha256").update(recoveryPayload.sessionSecret).digest("hex"));

    const takeover = await handleTinderMatchRoutes({
      request: makeRequest("another-account-token-which-must-not-replace"),
      path: "/match/tinder/connect",
      supabase,
      corsHeaders: {},
      originAllowed: true,
    });
    assert.equal(takeover.status, 401);
    assert.equal(config.auth_token, "the-existing-private-tinder-token");
    assert.equal(tinderRequests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
