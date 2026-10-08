import test from "node:test";
import assert from "node:assert/strict";

import { brainOperatorAllowedOrigin } from "../supabase/functions/api/brain_operator_auth.ts";

test("uma chave anon longa não autoriza uma origem externa desconhecida", () => {
  const originalDeno = globalThis.Deno;
  globalThis.Deno = { env: { get: (name) => name === "SUPABASE_ANON_KEY" ? "known-public-anon-key" : "" } };
  try {
    const request = new Request("https://api.vendeo.test/operator/chat-runtime", {
      headers: {
        origin: "https://attacker.example",
        apikey: "known-public-anon-key",
      },
    });
    assert.equal(brainOperatorAllowedOrigin(request), false);
  } finally {
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
  }
});

test("uma origem configurada continua autorizada mesmo com a chave pública oficial", () => {
  const originalDeno = globalThis.Deno;
  globalThis.Deno = { env: { get: (name) => name === "SUPABASE_ANON_KEY" ? "known-public-anon-key" : "" } };
  try {
    const request = new Request("https://api.vendeo.test/operator/chat-runtime", {
      headers: {
        origin: "https://vendeo-e755e.web.app",
        apikey: "known-public-anon-key",
      },
    });
    assert.equal(brainOperatorAllowedOrigin(request), true);
  } finally {
    if (originalDeno === undefined) delete globalThis.Deno;
    else globalThis.Deno = originalDeno;
  }
});
