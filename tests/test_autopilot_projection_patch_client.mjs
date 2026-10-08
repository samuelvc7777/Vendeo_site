import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { handleAutoPilotProjectionPatchRoute } from "../supabase/functions/api/autopilot_projection_route.ts";

const repositorySource = fs.readFileSync(
  new URL("../src/infrastructure/repositories/SupabaseAutoPilotRepository.ts", import.meta.url),
  "utf8",
);
const apiIndexSource = fs.readFileSync(
  new URL("../supabase/functions/api/index.ts", import.meta.url),
  "utf8",
);

test("o navegador envia atualizações de projeção pela API interna, não chama a RPC protegida", () => {
  assert.ok(/autopilotApiFetch/.test(repositorySource), "o repositório precisa usar o cliente da API interna");
  assert.ok(/\/api\/autopilot\/state-patch/.test(repositorySource), "o repositório precisa chamar a rota protegida");
  assert.ok(
    !/\.rpc\(["']patch_autopilot_projection_state_atomic["']/.test(repositorySource),
    "o navegador não pode chamar diretamente a RPC restrita a service_role",
  );
});

const headers = { "Access-Control-Allow-Origin": "https://vendeo-e755e.web.app" };

test("a rota recusa origens não permitidas sem chamar a RPC", async () => {
  let called = false;
  const response = await handleAutoPilotProjectionPatchRoute(
    new Request("https://api.vendeo.test/autopilot/state-patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "contact-1", statePatch: { status: "idle" } }),
    }),
    {
      supabase: {},
      corsHeaders: headers,
      originAllowed: false,
      patchProjection: async () => { called = true; return { success: true }; },
    },
  );

  assert.equal(response.status, 403);
  assert.equal(called, false);
});

test("o Edge API conecta a rota à projeção interna usando a validação de origem", () => {
  assert.ok(/path === "\/autopilot\/state-patch"/.test(apiIndexSource));
  assert.ok(/originAllowed:\s*brainOperatorAllowedOrigin\(req\)/.test(apiIndexSource));
  assert.ok(/patchProjection:\s*patchAutoPilotProjectionState/.test(apiIndexSource));
});

test("a rota delega a atualização ao patch de service_role e devolve o estado canônico", async () => {
  const supabase = { marker: true };
  let received;
  const response = await handleAutoPilotProjectionPatchRoute(
    new Request("https://api.vendeo.test/autopilot/state-patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: "contact-1",
        statePatch: { status: "waiting_delay" },
        expectedStateUpdatedAt: "2026-10-07T12:00:00.000Z",
      }),
    }),
    {
      supabase,
      corsHeaders: headers,
      originAllowed: true,
      patchProjection: async (...args) => {
        received = args;
        return { success: true, applied: true, state: { status: "waiting_delay" }, stateRevision: 2 };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(received, [supabase, "contact-1", { status: "waiting_delay" }, "2026-10-07T12:00:00.000Z"]);
  assert.deepEqual(await response.json(), {
    success: true,
    applied: true,
    state: { status: "waiting_delay" },
    stateRevision: 2,
  });
});

test("a rota valida versões e limita o tamanho da projeção", async () => {
  const invalidVersion = await handleAutoPilotProjectionPatchRoute(
    new Request("https://api.vendeo.test/autopilot/state-patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "contact-1", statePatch: {}, expectedStateUpdatedAt: "not-a-date" }),
    }),
    { supabase: {}, corsHeaders: headers, originAllowed: true, patchProjection: async () => ({ success: true }) },
  );
  assert.equal(invalidVersion.status, 400);

  const oversized = await handleAutoPilotProjectionPatchRoute(
    new Request("https://api.vendeo.test/autopilot/state-patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "contact-1", statePatch: { detail: "x".repeat(33000) } }),
    }),
    { supabase: {}, corsHeaders: headers, originAllowed: true, patchProjection: async () => ({ success: true }) },
  );
  assert.equal(oversized.status, 413);
});

test("a conversa inexistente retorna 404 em vez de expor erro interno", async () => {
  const response = await handleAutoPilotProjectionPatchRoute(
    new Request("https://api.vendeo.test/autopilot/state-patch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ conversationId: "missing-contact", statePatch: { status: "idle" } }),
    }),
    {
      supabase: {},
      corsHeaders: headers,
      originAllowed: true,
      patchProjection: async () => { throw new Error("conversation_not_found"); },
    },
  );

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, error: "conversation_not_found" });
});
