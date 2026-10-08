import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../scripts/node-esm-npm-loader.mjs', import.meta.url);
const { runDurableOutboxDispatcher } = await import('../supabase/functions/api/brain_orchestrator.ts');

test('dispatcher real bloqueia o restante do lote quando não consegue persistir a confirmação', async () => {
  let sends = 0;
  const outbox = Object.fromEntries([0,1].map(i => [`action-${i}`, { id: `action-${i}`, idempotencyKey: `action-${i}`, conversationId: 'audit-dispatch', cycleId: 'cycle', actionIndex: i, status: 'pending', channel: 'instagram', messageType: 'text', content: `Mensagem ${i}`, payload: {}, createdAt: new Date().toISOString() }]));
  const supabase = {
    rpc: async name => name === 'claim_outbox_entry' ? { data: { success: true }, error: null } : name === 'finalize_outbox_entry' ? { data: null, error: { message: 'persistence unavailable' } } : { data: { success: true }, error: null },
    from() {
      const q = { select: () => q, eq: () => q, update: () => q, upsert: () => q, insert: () => q,
        maybeSingle: async () => ({ data: { ai_auto_respond: true, stage_completed_rules: { orchestration: { outbox } } }, error: null }),
        then: resolve => Promise.resolve({ data: null, error: { message: 'persistence unavailable' } }).then(resolve), };
      return q;
    },
  };
  const result = await runDurableOutboxDispatcher({ supabase, conversationId: 'audit-dispatch', outboxMap: outbox, runtime: { sendMetaTextMessage: async () => { sends++; return { message_id: 'provider-confirmed' }; } } });
  assert.equal(sends, 1);
  assert.equal(result.success, false);
  assert.ok(result.errors.includes('confirmation_persistence_failed'));
});
