import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sdk = fs.readFileSync("supabase/functions/api/openai_sdk_brain.ts", "utf8");
const contract = fs.readFileSync("supabase/functions/api/openai_brain.ts", "utf8");
const catchBlock = sdk.slice(sdk.indexOf("  } catch (error) {", sdk.indexOf("export async function runOpenAiSdkBrainTurn")), sdk.length);

test("Flex capacity 429 retries the same Brain turn with standard processing", () => {
  assert.match(catchBlock, /params\.serviceTier === "flex"/);
  assert.match(catchBlock, /429\.\*flex processing is temporarily unavailable/i);
  assert.match(catchBlock, /runOpenAiSdkBrainTurn\(\{\s*\.\.\.params,\s*serviceTier: "default"/);
  assert.match(catchBlock, /serviceTierFallbackUsed = true/);
  assert.match(catchBlock, /serviceTierFallbackFrom = "flex"/);
});

test("Flex fallback occurs before failing the durable execution and only retries once", () => {
  const fallback = catchBlock.indexOf("if (flexCapacityUnavailable)");
  const markFailed = catchBlock.indexOf("await failSdkExecution(params.supabase, executionKey, executionTurnId, error)");
  assert.ok(fallback >= 0);
  assert.ok(markFailed > fallback);
  assert.match(catchBlock, /serviceTier: "default"/);
  assert.doesNotMatch(catchBlock.slice(catchBlock.indexOf("const retried = await runOpenAiSdkBrainTurn"), catchBlock.indexOf("return retried;")), /serviceTier: "flex"/);
});

test("fallback telemetry fields are declared", () => {
  assert.match(contract, /serviceTierFallbackUsed\?: boolean/);
  assert.match(contract, /serviceTierFallbackFrom\?: "flex"/);
});
