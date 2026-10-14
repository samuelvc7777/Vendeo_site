import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const sdkUrl = new URL("../supabase/functions/api/openai_sdk_brain.ts", import.meta.url);
const sdk = readFileSync(sdkUrl, "utf8");
const orchestrator = readFileSync(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
const brainTypes = readFileSync(new URL("../supabase/functions/api/openai_brain.ts", import.meta.url), "utf8");

test("Brain não troca Flex para Standard ao receber 429 do provider", () => {
  assert.doesNotMatch(sdk, /shouldRetryFlexCapacityOnStandard|flex_capacity_unavailable_retry_standard/);
  assert.doesNotMatch(sdk, /flexCapacityFallbackAttempted|flexCapacityFallbackTriggered|flexCapacityFallbackReason/);
  assert.doesNotMatch(sdk, /serviceTier:\s*["']default["']/);
  assert.doesNotMatch(brainTypes, /flexCapacityFallbackAttempted|flexCapacityFallbackTriggered|flexCapacityFallbackReason/);
  assert.equal(existsSync(new URL("../supabase/functions/api/flex_capacity_policy.ts", import.meta.url)), false);
});

test("preserva o tier configurado no provider e falha sem fallback de preço", () => {
  assert.match(orchestrator, /\.in\("id", \["openai_brain_reasoning_effort", "openai_brain_verbosity", "openai_brain_service_tier"\]\)/);
  assert.match(orchestrator, /serviceTier:\s*configuredServiceTier/);
  assert.match(sdk, /service_tier:\s*serviceTier/);
  assert.match(sdk, /error:\s*errorMessage,\s*telemetry,/);
});

test("não interfere em recuperação técnica que preserva o mesmo tier", () => {
  assert.match(sdk, /technicalRepairCount:\s*\(params\.technicalRepairCount \|\| 0\) \+ 1/);
  assert.match(sdk, /const serviceTier: "auto" \| "default" \| "flex" = params\.serviceTier \|\| "auto";/);
});
