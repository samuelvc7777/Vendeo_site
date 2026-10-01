import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const api = fs.readFileSync(
  new URL("../supabase/functions/api/index.ts", import.meta.url),
  "utf8",
);

test("Instagram config production route supports GET, POST and DELETE", () => {
  assert.match(api, /path === "\/instagram\/config" && req\.method === "GET"/);
  assert.match(api, /path === "\/instagram\/config" && req\.method === "POST"/);
  assert.match(api, /path === "\/instagram\/config" && req\.method === "DELETE"/);
  assert.match(api, /access_token: resolvedAccessToken/);
  assert.match(api, /is_connected: true/);
  assert.doesNotMatch(api, /if \(path === "\/instagram\/config"\) \{/);
});
