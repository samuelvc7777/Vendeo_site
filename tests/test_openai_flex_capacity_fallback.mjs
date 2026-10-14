import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { shouldRetryFlexCapacityOnStandard } from "../supabase/functions/api/flex_capacity_policy.ts";

test("429 Flex sem capacidade habilita UMA segunda tentativa Standard", () => {
  const error = "429 Flex processing is temporarily unavailable. Please try again later or use standard processing.";
  assert.equal(shouldRetryFlexCapacityOnStandard(error, "flex", false), true);
  assert.equal(shouldRetryFlexCapacityOnStandard(error, "flex", true), false);
  assert.equal(shouldRetryFlexCapacityOnStandard(error, "default", false), false);
  assert.equal(shouldRetryFlexCapacityOnStandard(error, "auto", false), false);
});

test("outros erros nao geram trocas de tier nem retries indevidos", () => {
  assert.equal(shouldRetryFlexCapacityOnStandard("429 You exceeded your current quota", "flex", false), false);
  assert.equal(shouldRetryFlexCapacityOnStandard("429 Rate limit reached", "flex", false), false);
  assert.equal(shouldRetryFlexCapacityOnStandard("400 Another process is currently operating on this conversation", "flex", false), false);
  assert.equal(shouldRetryFlexCapacityOnStandard("500 Flex processing is temporarily unavailable", "flex", false), false);
});

test("fallback exclusivo de infraestrutura, nunca semantica", () => {
  const sdk = readFileSync(new URL("../supabase/functions/api/openai_sdk_brain.ts", import.meta.url), "utf8");
  assert.match(sdk, /shouldRetryFlexCapacityOnStandard\(/);
  assert.match(sdk, /flexCapacityFallbackAttempted: true/);
  assert.match(sdk, /serviceTier: "default"/);
  assert.match(sdk, /flexCapacityFallbackTriggered = true/);
  assert.match(sdk, /service_tier: serviceTier/);
});
