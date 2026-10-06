import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const hook = fs.readFileSync(
  new URL("../src/presentation/hooks/useRaffles.ts", import.meta.url),
  "utf8",
);
const connector = fs.readFileSync(
  new URL("../src/presentation/components/sales/WhatsAppBuyerConnector.tsx", import.meta.url),
  "utf8",
);
const gateway = fs.readFileSync(
  new URL("../services/whatsapp2-gateway/index.cjs", import.meta.url),
  "utf8",
);

test("seletor de rifa usa apenas conversas finalizadas e não arquivadas/trancadas", () => {
  assert.match(hook, /\.eq\("is_converted", true\)/);
  assert.match(hook, /\.not\("workflow_finalized_at", "is", null\)/);
  assert.match(hook, /\.neq\("status", "locked"\)/);
  assert.match(hook, /\.neq\("status", "archived"\)/);
});

test("seletor não limita quantidade de contatos exibidos", () => {
  assert.doesNotMatch(connector, /whatsappContacts\.slice\(0,\s*16\)/);
  assert.doesNotMatch(connector, /\.slice\(0,\s*24\)/);
});

test("nome salvo do WhatsApp tem prioridade sobre nome legado do Supabase", () => {
  assert.match(hook, /identity\?\.savedName[\s\S]*row\.full_name/);
  assert.match(gateway, /savedName:/);
  assert.match(gateway, /getContactById/);
  assert.match(gateway, /identity\?\.savedName[\s\S]*chat\.name/);
});
