import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../scripts/node-esm-npm-loader.mjs', import.meta.url);
const { finalizeOutboxEntryAtomic } = await import('../supabase/functions/api/brain_orchestrator.ts');

test('falha da finalização atômica não regrava o JSON completo nem informa sucesso', async () => {
  let writes = 0;
  const supabase = {
    rpc: async () => ({ data: null, error: { message: 'database unavailable' } }),
    from() {
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: { stage_completed_rules: { orchestration: { outbox: { action: { status: 'sending' } } } } }, error: null }),
        update: () => { writes++; return q; }, then: resolve => Promise.resolve({ error: { message: 'database unavailable' } }).then(resolve) };
      return q;
    },
  };
  const result = await finalizeOutboxEntryAtomic({ supabase, conversationId: 'test', outboxId: 'action', status: 'sent', providerMessageId: 'provider' });
  assert.equal(result.success, false);
  assert.equal(writes, 0);
});
