import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");

test("reinício reativa status antes de enfileirar sem avançar o watermark", () => {
  const api = read("supabase/functions/api/index.ts");
  const routeStart = api.indexOf('path === "/autopilot/restart-chat"');
  const routeEnd = api.indexOf('path === "/autopilot/toggle-chat"', routeStart);
  const route = api.slice(routeStart, routeEnd);
  const restartCall = route.indexOf('"restart_autopilot_runtime_atomic"');
  const resumeCall = route.indexOf('"activate_autopilot_runtime_after_restart_atomic"');
  const enqueueCall = route.indexOf('"enqueue_autopilot_inbound_job"');

  assert.ok(restartCall >= 0 && resumeCall > restartCall && enqueueCall > resumeCall);
  assert.match(route, /runtimeResumeResult\?\.success !== true/);

  const migration = read("supabase/migrations/20261007045000_activate_autopilot_runtime_after_restart.sql");
  const functionBody = migration.split("as $$")[1]?.split("$$;")[0] || "";
  assert.match(functionBody, /jsonb_set\(v_rules, '\{status\}', '"active"'::jsonb, true\)/);
  assert.match(functionBody, /'disabled'/);
  assert.doesNotMatch(functionBody, /activation_watermark/);
});
