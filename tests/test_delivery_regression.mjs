import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const uiSource = readFileSync(new URL("../src/presentation/components/chat/AutoPilotActivityIndicator.tsx", import.meta.url), "utf8");

test("caso Tiquin: conclusão do Brain não marca envio como concluído", () => {
  assert.doesNotMatch(uiSource, /const isSendingDone\s*=\s*isCompleted/);
});
