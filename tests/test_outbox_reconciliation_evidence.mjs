import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../scripts/node-esm-npm-loader.mjs', import.meta.url);
const { reconcileUncertainOutboxAction } = await import('../supabase/functions/api/brain_orchestrator.ts');

const conversationId = 'wa2:account-5511999999999:5511888888888@c.us';
const entry = { id: 'action', idempotencyKey: 'exact-queue-key', conversationId, channel: 'whatsapp2', status: 'dispatch_uncertain', messageType: 'audio', content: '[audio:https://example.com/a.mp3]', mediaUrl: 'https://example.com/a.mp3', payload: {} };
function db({ messages = [], delivery = null, accepted = true } = {}) {
  const rpcCalls = [];
  return {
    rpcCalls,
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: { success: accepted, reason: accepted ? 'reconciled_sent' : 'outbox_entry_not_found' }, error: null }; },
    from(table) {
      const q = { select: () => q, eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: delivery, error: null }),
        then: (resolve, reject) => Promise.resolve({ data: messages, error: null }).then(resolve, reject),
      };
      assert.ok(['instagram_messages', 'whatsapp2_delivery_queue'].includes(table), table);
      return q;
    },
  };
}

test('áudio antigo no histórico não prova que a ação incerta foi entregue', async () => {
  const supabase = db({ messages: [{ id: 'unrelated-old-audio', text: '[audio:https://example.com/old.mp3]' }] });
  const result = await reconcileUncertainOutboxAction({ supabase, conversationId, outboxEntry: entry });
  assert.equal(result.reconciled, false);
  assert.equal(result.status, 'uncertain');
  assert.equal(supabase.rpcCalls.length, 0);
});

test('falha da RPC de reconciliação não pode confirmar nem liberar a próxima ação', async () => {
  const supabase = db({ accepted: false });
  const result = await reconcileUncertainOutboxAction({ supabase, conversationId, outboxEntry: entry, runtime: { checkMessageDelivered: async () => ({ delivered: true, messageId: 'confirmed' }) } });
  assert.equal(result.reconciled, false);
  assert.equal(result.status, 'uncertain');
});

test('confirmação da fila exata reconcilia mesmo sem a mensagem estar entre as últimas cinco', async () => {
  const supabase = db({ delivery: { id: 'exact-queue-key', conversation_id: conversationId, gateway_account_id: 'account-5511999999999', status: 'sent', provider_message_id: 'confirmed-provider-id' } });
  const result = await reconcileUncertainOutboxAction({ supabase, conversationId, outboxEntry: entry });
  assert.equal(result.reconciled, true);
  assert.equal(result.providerMessageId, 'confirmed-provider-id');
  assert.equal(supabase.rpcCalls.length, 1);
});

test('confirmação de outra conta não libera a ação', async () => {
  const supabase = db({ delivery: { id: 'exact-queue-key', conversation_id: conversationId, gateway_account_id: 'account-5521999999999', status: 'sent', provider_message_id: 'other-account-message' } });
  const result = await reconcileUncertainOutboxAction({ supabase, conversationId, outboxEntry: entry });
  assert.equal(result.reconciled, false);
  assert.equal(supabase.rpcCalls.length, 0);
});
