import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enrichBrainDecisionActionRows } from "../supabase/functions/api/brain_event_enrichment.ts";
import { toProviderErrorDetails } from "../supabase/functions/api/brain_orchestrator.ts";
import {
  attachDeliveryActionsToTurns,
  deriveDeliveryProjection,
  groupBrainTurns,
} from "../src/presentation/components/chat/brain-turn-view-model.ts";

const uiSource = readFileSync(new URL("../src/presentation/components/chat/AutoPilotActivityIndicator.tsx", import.meta.url), "utf8");
const endpointSource = readFileSync(new URL("../supabase/functions/api/index.ts", import.meta.url), "utf8");

const action = (status, index, providerMessageId = null, overrides = {}) => ({
  id: `action-${index}`,
  decisionId: "decision-1",
  turnId: "turn-1",
  actionIndex: index,
  actionType: "text",
  status,
  providerMessageId,
  ...overrides,
});

test("A — 2/2 ações confirmadas exibem sucesso de entrega", () => {
  const projection = deriveDeliveryProjection([
    action("sent", 0, "provider-0"),
    action("sent", 1, "provider-1"),
  ]);
  assert.equal(projection.status, "fully_sent");
  assert.equal(projection.label, "2 de 2 mensagens enviadas");
  assert.equal(projection.showSuccess, true);
});

test("B — failed_confirmed + pending exibem falha e 0/2, sem check", () => {
  const projection = deriveDeliveryProjection([
    action("failed_confirmed", 0),
    action("pending", 1),
  ], { deliveryStatus: "delivery_pending" });
  assert.equal(projection.status, "failed");
  assert.equal(projection.statusLabel, "Falha no envio");
  assert.equal(projection.label, "0 de 2 mensagens enviadas");
  assert.equal(projection.showSuccess, false);
});

test("C — sent + pending exibem parcial 1/2, sem check final", () => {
  const projection = deriveDeliveryProjection([
    action("sent", 0, "provider-0"),
    action("pending", 1),
  ]);
  assert.equal(projection.status, "partially_sent");
  assert.equal(projection.label, "1 de 2 mensagens enviadas");
  assert.equal(projection.showSuccess, false);
});

test("D — dispatch_uncertain exige reconciliação e nunca mostra check", () => {
  const projection = deriveDeliveryProjection([action("dispatch_uncertain", 0)]);
  assert.equal(projection.status, "uncertain");
  assert.equal(projection.statusLabel, "Confirmação de envio pendente");
  assert.equal(projection.showSuccess, false);
});

test("E — cycle_completed + delivery_pending não conclui o envio", () => {
  const projection = deriveDeliveryProjection([
    action("pending", 0),
    action("pending", 1),
  ], { deliveryStatus: "delivery_pending", cycleStatus: "cycle_completed", sentBalloonsCount: 0 });
  assert.equal(projection.status, "pending");
  assert.equal(projection.sentCount, 0);
  assert.equal(projection.showSuccess, false);
});

test("delivery_status pendente contraditório também bloqueia o check final", () => {
  const projection = deriveDeliveryProjection([
    action("sent", 0, "provider-0"),
    action("sent", 1, "provider-1"),
  ], { deliveryStatus: "delivery_pending" });
  assert.equal(projection.status, "pending");
  assert.equal(projection.showSuccess, false);
});

test("F — provider_message_id nulo impede que status sent conte como confirmação", () => {
  const projection = deriveDeliveryProjection([action("sent", 0, null)]);
  assert.equal(projection.status, "uncertain");
  assert.equal(projection.sentCount, 0);
  assert.equal(projection.showSuccess, false);
});

test("G — fixture Tiquin associa as ações ao turno concluído sem confundir Brain e entrega", () => {
  const rows = enrichBrainDecisionActionRows([
    { id: "action-0", decision_id: "decision-tiquin", action_index: 0, action_type: "text", status: "failed_confirmed", provider_message_id: null, attempts: 3 },
    { id: "action-1", decision_id: "decision-tiquin", action_index: 1, action_type: "text", status: "pending", provider_message_id: null, attempts: 0 },
  ], [
    { id: "decision-tiquin", turn_id: "turn-tiquin", delivery_status: "delivery_pending" },
  ]);
  const actions = rows.map((row) => ({
    id: row.id,
    decisionId: row.decision_id,
    turnId: row.turn_id,
    actionIndex: row.action_index,
    actionType: row.action_type,
    status: row.status,
    providerMessageId: row.provider_message_id,
    attempts: row.attempts,
    deliveryStatus: row.decision_delivery_status,
  }));
  const [turn] = attachDeliveryActionsToTurns(groupBrainTurns([{
    turnId: "turn-tiquin",
    decisionId: "decision-tiquin",
    sessionId: "persistent-session",
    cycleId: "cycle-tiquin",
    conversationId: "conversation-tiquin",
    sequence: 10,
    event: "cycle_completed",
    phase: "completed",
    timestamp: "2026-09-27T09:21:00-03:00",
    metadata: { deliveryStatus: "delivery_pending", sentBalloonsCount: 0, totalBalloons: 2 },
  }, {
    turnId: "turn-tiquin",
    decisionId: "decision-tiquin",
    sessionId: "persistent-session",
    cycleId: "cycle-tiquin",
    conversationId: "conversation-tiquin",
    sequence: 11,
    event: "action_failed_confirmed",
    status: "failed_confirmed",
    phase: "failed",
    timestamp: "2026-09-27T09:21:02-03:00",
    actionId: "action-0",
    metadata: {},
  }]), actions);

  assert.equal(turn.status, "completed", "a falha de entrega não rebaixa a conclusão semântica do Brain");
  assert.equal(turn.delivery.status, "failed");
  assert.equal(turn.delivery.sentCount, 0);
  assert.equal(turn.delivery.actionCount, 2);
  assert.deepEqual(turn.deliveryActions.map((row) => row.status), ["failed_confirmed", "pending"]);
  assert.equal(turn.delivery.label, "0 de 2 mensagens enviadas");
  assert.equal(turn.delivery.showSuccess, false);
  assert.doesNotMatch(uiSource, /isSendingDone\s*=\s*isCompleted/);
  assert.match(uiSource, /deliveryProjection\.showSuccess/);
});

test("o endpoint fornece todas as ações com status, provider ID e turno canônico", () => {
  const routeStart = endpointSource.indexOf('path === "/autopilot/brain-events"');
  const routeEnd = endpointSource.indexOf('if ((path === "/autopilot/retry-failed-action"', routeStart);
  const route = endpointSource.slice(routeStart, routeEnd);
  assert.match(route, /from\("brain_decision_actions"\)[\s\S]*select\("id, decision_id, action_index, action_type, status, provider_message_id, attempts, created_at"\)/);
  assert.match(route, /actions: deliveryActions/);
  assert.match(route, /enrichBrainDecisionActionRows/);
  assert.doesNotMatch(route, /\.eq\("status",\s*"failed_confirmed"\)/);
});

test("o erro Meta real é normalizado para detalhes técnicos e conectado ao evento", () => {
  const details = toProviderErrorDetails('Falha no envio pela Meta (HTTP 403): {"error":{"message":"Essa mensagem foi enviada fora do período permitido.","type":"OAuthException","code":10,"error_subcode":2534022}}');
  assert.deepEqual(details, {
    provider: "Meta",
    message: "Essa mensagem foi enviada fora do período permitido.",
    httpStatus: 403,
    code: 10,
    subcode: 2534022,
  });
  const orchestratorSource = readFileSync(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
  assert.equal(/providerError: dispatchRes\.error/.test(orchestratorSource), true);
  assert.equal(/<ProviderErrorDetails value=/.test(uiSource), true);
});

test("steppers sem ações ou apenas metadados de conclusão nunca fabricam entrega", () => {
  const noActions = deriveDeliveryProjection([], { deliveryStatus: "fully_sent" });
  const pendingActions = deriveDeliveryProjection([
    action("pending", 0),
    action("pending", 1),
  ], { cycleStatus: "cycle_completed", deliveryStatus: "delivery_pending", sentBalloonsCount: 0 });
  assert.equal(noActions.showSuccess, false);
  assert.equal(pendingActions.showSuccess, false);
  assert.equal(pendingActions.sentCount, 0);
});
