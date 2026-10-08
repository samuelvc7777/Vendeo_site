import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../scripts/node-esm-npm-loader.mjs', import.meta.url);
const { dispatchOutboxEntry } = await import('../supabase/functions/api/brain_orchestrator.ts');
test('HTTP 200 sem ID do provedor não confirma envio Instagram', async () => {
  const originalFetch=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async () => { requests++; return { ok: true, json: async () => ({}) }; };
  const entry={ id:'audit',conversationId:'audit-provider',status:'sending',sendingAt:new Date().toISOString(),claimedBy:'audit',channel:'instagram',content:'teste',messageType:'text',payload:{},attempts:1,maxAttempts:3 };
  const supabase={from(table){const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='instagram_config'?{access_token:'mock-only'}:{channel:'instagram'},error:null})};return q;}};
  try {
    const result=await dispatchOutboxEntry({supabase,outboxEntry:entry,recipientId:'audit-provider',claimToken:'audit'});
    assert.equal(requests,1);
    assert.equal(result.success,false);
    assert.equal(result.isUncertain,true);
    assert.equal(entry.providerMessageId,undefined);
  } finally { globalThis.fetch=originalFetch; }
});
