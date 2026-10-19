import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ui = fs.readFileSync("src/presentation/components/chat/WhatsAppFinalizationActions.tsx", "utf8");
const chat = fs.readFileSync("src/presentation/components/chat/InstagramDirect.tsx", "utf8");
const client = fs.readFileSync("src/presentation/components/chat/whatsapp2-client.ts", "utf8");
const gateway = fs.readFileSync("services/whatsapp2-gateway/index.cjs", "utf8");
const sql = fs.readFileSync("supabase/migrations/20261019112000_whatsapp_finalization_vault_and_delivery.sql", "utf8");
const route = gateway.slice(gateway.indexOf('url.pathname === "/messages/finalization/queue"'),gateway.indexOf('url.pathname === "/messages/send"'));

test("dois botões do chat WhatsApp, cofre separado e confirmação explícita", () => {
  assert.match(chat, /activeChat\.type === "whatsapp2" && \(\s*<WhatsAppFinalizationActions/);
  assert.match(ui, /Abrir cofre de finalização/);
  assert.match(ui, /Enviar mensagens de finalização para esta conversa/);
  assert.match(ui, /window\.confirm\(/);
  assert.match(ui, /"whatsapp_finalization_vault_items"/);
  assert.match(ui, /const MAX_ITEMS = 30/);
});

test("texto, áudio de voz gravada e fotos em ordem mutável, armazenados no Supabase", () => {
  assert.match(ui, /kind === "audio" \? await convertToWhatsAppVoiceNote\(file\)/);
  assert.match(ui, /getApiUrl\("\/api\/instagram\/upload"\)/);
  assert.match(ui, /await client\(\)\.from\(TABLE\)\.insert/);
  assert.match(ui, /await client\(\)\.from\(TABLE\)\.delete\(\)/);
  assert.match(ui, /const move = async/);
  assert.match(ui, /setEditingId\(item\.id\)/);
  assert.match(ui, /const delay: Record<FinalizationKind, number> = \{ text: 10, audio: 10, image: 3, raffle_numbers: 10 \}/);
});

test("fila durável ordenada e idempotente; nenhuma duplicação em recarga", () => {
  assert.match(sql, /add column if not exists scheduled_at timestamptz/);
  assert.match(sql, /q\.scheduled_at <= clock_timestamp\(\)/);
  assert.match(sql, /left\(earlier\.id, 41\) = left\(q\.id, 41\)/);
  assert.match(sql, /earlier\.status <> 'sent'/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /v_existing > 0/);
  assert.match(sql, /v_next := v_next \+ case when v_item\.kind = 'image'/);
  assert.match(sql, /then interval '3 seconds' else interval '10 seconds'/);
  assert.match(sql, /voice_note,status,scheduled_at/);
});

test("gateway valida origem, conta, identidade e lê itens do cofre no banco", () => {
  assert.match(route, /origin !== "https:\/\/vendeo-e755e\.web\.app"/);
  assert.match(route, /Origem não autorizada/);
  assert.match(route, /whatsappAccountIdFromConversationId\(conversationId\) !== accountId/);
  assert.match(route, /resolveCanonicalConversationId\(recipient\)/);
  assert.match(route, /if \(!chat \|\| chat\.isGroup\)/);
  assert.match(route, /enqueue_whatsapp_finalization_batch/);
  assert.doesNotMatch(route, /body\.items/);
  assert.match(client, /export async function queueWhatsApp2Finalization/);
  assert.match(ui, /requestRef\.current/);
});

test("worker só envia os itens vencidos e áudio como nota de voz", () => {
  assert.match(gateway, /claim_whatsapp2_delivery_batch/);
  assert.match(gateway, /asVoice: job\.kind === "audio" && job\.voice_note === true/);
  assert.match(gateway, /sendMediaInternal/);
  assert.match(gateway, /sendTextInternal/);
});
