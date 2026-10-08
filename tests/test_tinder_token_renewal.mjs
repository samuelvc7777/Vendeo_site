import test from "node:test";
import assert from "node:assert/strict";
import { handleTinderMatchRoutes } from "../supabase/functions/api/tinder_match_routes.ts";

const stored = {
  id: "default",
  auth_token: "old-access-token-for-profile",
  user_id: "account-123",
  session_hash: "existing-session-hash",
};

function createMockDatabase() {
  const writes = [];
  const supabase = {
    from(table) {
      assert.equal(table, "match_tinder_config");
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: { ...stored }, error: null }; },
        async upsert(value) {
          writes.push(value);
          return { error: null };
        },
      };
    },
  };
  return { supabase, writes };
}

async function connectWith(profileId, upstreamStatus = 200) {
  const originalFetch = globalThis.fetch;
  const { supabase, writes } = createMockDatabase();
  let fetches = 0;
  globalThis.fetch = async (_url, init) => {
    fetches++;
    assert.equal(init.headers["X-Auth-Token"], "new-access-token-for-profile");
    if (upstreamStatus !== 200) {
      return new Response(JSON.stringify({ error: "invalid token" }), {
        status: upstreamStatus, headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ data: { user: { _id: profileId, name: "Profile Tester", photos: [] } } }), {
      status: 200, headers: { "content-type": "application/json" },
    });
  };
  try {
    const response = await handleTinderMatchRoutes({
      request: new Request("https://vendeo.test/api/match/tinder/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "new-access-token-for-profile" }),
      }),
      path: "/match/tinder/connect",
      supabase,
      corsHeaders: {},
      originAllowed: true,
    });
    return { status: response.status, body: await response.json(), writes, fetches };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("token renovado da mesma conta recupera sessão sem a anterior", async () => {
  const result = await connectWith("account-123");
  assert.equal(result.status, 200);
  assert.equal(result.body.connected, true);
  assert.ok(result.body.sessionSecret);
  assert.equal(result.writes.length, 1);
  assert.equal(result.writes[0].user_id, "account-123");
  assert.equal(result.fetches, 1);
});

test("token de outra conta não substitui uma conexão sem sessão", async () => {
  const result = await connectWith("different-account-999");
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "MATCH_ACCOUNT_SWITCH_REQUIRES_SESSION");
  assert.equal(result.writes.length, 0);
});

test("token inválido do Tinder não altera dados ou sessão", async () => {
  const result = await connectWith("account-123", 401);
  assert.equal(result.status, 401);
  assert.equal(result.body.code, "TINDER_AUTH_INVALID");
  assert.equal(result.writes.length, 0);
});
