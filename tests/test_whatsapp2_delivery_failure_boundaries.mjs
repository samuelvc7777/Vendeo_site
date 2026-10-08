import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

async function runWorker({ mediaError, finalizeError = false, missingProviderId = false, sendError = null } = {}) {
  const source = fs.readFileSync(new URL('../services/whatsapp2-gateway/index.cjs', import.meta.url), 'utf8');
  const start = source.indexOf('async function processDeliveryQueue() {');
  const end = source.indexOf('\nfunction ', start);
  assert.ok(start > 0 && end > start);
  const completions = [];
  let sends = 0;
  const context = {
    state: { status: 'ready' }, deliveryWorkerRunning: false,
    currentWhatsApp2AccountId: () => 'account-5511999999999',
    WORKER_ID: 'worker', WHATSAPP2_DELIVERY_BATCH_LIMIT: 1, WHATSAPP2_DELIVERY_MAX_ATTEMPTS: 3,
    supabase: { rpc: async () => ({ data: [{ id: 'job', kind: mediaError ? 'audio' : 'text', attempts: 1, recipient_id: '5511888888888@c.us', text_content: 'Teste' }], error: null }) },
    sendTextInternal: async () => { sends++; if (sendError) throw new Error(sendError); return missingProviderId ? {} : { id: 'provider-confirmed' }; },
    sendMediaInternal: async () => { sends++; throw new Error(mediaError); },
    finalizeDeliveryJob: async (args) => {
      completions.push(args);
      if (finalizeError && completions.length === 1) throw new Error('whatsapp2_delivery_finalize_failed:fetch failed');
      return { success: true };
    },
    saveRecipientContactForDeliveryJob: async () => {},
    console: { warn() {}, error() {} }, setImmediate() {},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  await context.processDeliveryQueue();
  return { sends, completions };
}

test('falha de persistência após envio confirmado preserva o ID e nunca registra falha reenviável', async () => {
  const { sends, completions } = await runWorker({ finalizeError: true });
  assert.equal(sends, 1);
  assert.equal(completions.length, 2);
  assert.equal(completions[1].success, true);
  assert.equal(completions[1].providerMessageId, 'provider-confirmed');
});

test('timeout ao baixar mídia antes de enviar é falha segura, não entrega incerta', async () => {
  const { completions } = await runWorker({ mediaError: 'whatsapp2_media_url_timeout' });
  assert.equal(completions[0].success, false);
  assert.equal(completions[0].uncertain, false);
});

test('retorno sem ID do provedor não pode ser anunciado como envio confirmado', async () => {
  const { completions } = await runWorker({ missingProviderId: true });
  assert.equal(completions[0].success, false);
  assert.equal(completions[0].uncertain, true);
});

test('falha desconhecida durante chamada do provedor não permite reenvio cego', async () => {
  const { completions } = await runWorker({ sendError: 'Execution context was destroyed' });
  assert.equal(completions[0].uncertain, true);
});
