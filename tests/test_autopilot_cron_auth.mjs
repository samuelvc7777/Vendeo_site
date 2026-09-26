import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorizedAutopilotCron } from "../supabase/functions/api/autopilot_cron_auth.ts";

test("cron authentication checks the dedicated database token", async () => {
  let call;
  const authorized = await isAuthorizedAutopilotCron(
    {
      async rpc(name, args) {
        call = { name, args };
        return { data: true, error: null };
      },
    },
    "dedicated-cron-token",
  );

  assert.equal(authorized, true);
  assert.deepEqual(call, {
    name: "verify_autopilot_cron_token",
    args: { p_token: "dedicated-cron-token" },
  });
});

test("cron authentication rejects missing tokens and database errors", async () => {
  let calls = 0;
  const supabase = {
    async rpc() {
      calls += 1;
      return { data: true, error: null };
    },
  };

  assert.equal(await isAuthorizedAutopilotCron(supabase, null), false);
  assert.equal(calls, 0);
  assert.equal(
    await isAuthorizedAutopilotCron({ rpc: async () => ({ data: true, error: new Error("db unavailable") }) }, "token"),
    false,
  );
  assert.equal(
    await isAuthorizedAutopilotCron({ rpc: async () => ({ data: false, error: null }) }, "wrong-token"),
    false,
  );
});
