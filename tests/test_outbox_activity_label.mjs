import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outboxActivityLabel } from "../supabase/functions/api/outbox_activity_label.ts";

test("mostra a etapa operacional real sem interpretar o texto do Brain", () => {
  assert.equal(outboxActivityLabel([]), "Aguardando nova mensagem");
  assert.equal(outboxActivityLabel(["pending", "pending"]), "Aguardando envio");
  assert.equal(outboxActivityLabel(["sent", "pending"]), "Aguardando envio");
  assert.equal(outboxActivityLabel(["sent", "sending"]), "Enviando mensagens");
  assert.equal(outboxActivityLabel(["sent", "sent"]), "Brain respondeu");
  assert.equal(outboxActivityLabel(["dispatch_uncertain"]), "Entrega incerta");
  assert.equal(outboxActivityLabel(["failed_confirmed"]), "Falha no envio");
  assert.equal(outboxActivityLabel(["failed_retryable"]), "Nova tentativa programada");
  assert.equal(outboxActivityLabel(["cancelled"]), "Envio cancelado");
});

test("dispatch publica progresso e fim do envio sem sobrescrever ciclos novos", () => {
  const source = readFileSync(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
  assert.match(source, /outboxActivityLabel\(decisionOutboxStatuses\)/);
  assert.match(source, /syncOutboxActivity\(claimedEntry\.id\)/);
  assert.match(source, /await syncOutboxActivity\(\)/);
  assert.match(source, /projection\.state_updated_at/);
  assert.match(source, /projection\?\.status !== "idle"/);
  assert.match(source, /entry\.cycleId === projectedCycleId/);
  assert.doesNotMatch(source, /"Brain avaliou"/);
});
