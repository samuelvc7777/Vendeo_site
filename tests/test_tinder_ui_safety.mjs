import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { handleTinderMatchRoutes } from "../supabase/functions/api/tinder_match_routes.ts";

const view = readFileSync(new URL("../src/presentation/components/match/MatchView.tsx", import.meta.url), "utf8");
const chat = readFileSync(new URL("../src/presentation/components/match/MatchChatModal.tsx", import.meta.url), "utf8");
const api = readFileSync(new URL("../supabase/functions/api/index.ts", import.meta.url), "utf8");

test("listas vazias de matches e curtidas não disparam refetch infinito", () => {
  assert.match(view, /section === "matches" && !matchesLoaded/);
  assert.match(view, /setMatchesLoaded\(true\)/);
  assert.match(view, /section === "likes" && !likesLoaded/);
  assert.match(view, /section === "profile" && !accountLoaded/);
});

test("chat Tinder atualiza no foco e por intervalo sem duplicar IDs", () => {
  assert.match(chat, /setInterval\(poll, 20000\)/);
  assert.match(chat, /visibilityState === "visible"/);
  assert.match(chat, /new Map\(previous\.map/);
  assert.match(chat, /inFlightMatchesRef/);
});

test("IA Tinder exige sessão e flags antes do toggle", () => {
  assert.match(api, /await requireTinderMatchSession\(req, supabase\)/);
  assert.match(api, /isEnabled && !tinderAutomationReadiness\(\)\.enabled/);
  assert.match(chat, /<TinderAiControl match=\{match\}/);
});

test("Boost rejeita consumo sem confirmação explícita", async () => {
  const secret = "tinder-ui-safety-session";
  const hashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const sessionHash = Array.from(new Uint8Array(hashBytes)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const supabase = {
    from(table) {
      assert.equal(table, "match_tinder_config");
      return {
        select() { return this; },
        eq() { return this; },
        async maybeSingle() { return { data: { auth_token: "not-a-real-token", session_hash: sessionHash }, error: null }; },
      };
    },
  };
  const response = await handleTinderMatchRoutes({
    request: new Request("https://vendeo.test/match/tinder/boost", {
      method: "POST",
      headers: { "x-match-session": secret, "content-type": "application/json" },
      body: JSON.stringify({}),
    }),
    path: "/match/tinder/boost",
    supabase,
    corsHeaders: {},
    originAllowed: true,
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "TINDER_BOOST_CONFIRM_REQUIRED");
});

test("Rewind não simula desfazer ações do usuário", () => {
  assert.match(view, /window\.open\("https:\/\/tinder\.com\/app\/recs"/);
  assert.doesNotMatch(view, /swipeTinder\([^\n]+true\)/);
});
