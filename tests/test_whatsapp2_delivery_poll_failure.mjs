import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueAndWaitWhatsApp2Delivery } from '../supabase/functions/api/whatsapp2_gateway.ts';

test('perder acesso à fila depois de enfileirar não prova falha de envio', async () => {
  let reads = 0;
  const supabase = { from() { return {
    select() { const q = { eq: () => q, maybeSingle: async () => ++reads === 1
      ? { data: null, error: null } : { data: null, error: { message: 'fetch failed' } } }; return q; },
    insert: async () => ({ error: null }),
  }; } };
  const result = await enqueueAndWaitWhatsApp2Delivery({
    supabase, queueId: 'poll-loss', conversationId: 'wa2:account-5511999999999:5511888888888@c.us',
    recipientId: '5511888888888@c.us', kind: 'text', text: 'Teste',
  });
  assert.equal(result.success, false);
  assert.equal(result.isUncertain, true);
});
