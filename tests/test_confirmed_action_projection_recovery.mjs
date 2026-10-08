import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
register('../scripts/node-esm-npm-loader.mjs', import.meta.url);
const { runDurableOutboxDispatcher } = await import('../supabase/functions/api/brain_orchestrator.ts');
for (const [wrongAccount,wrongSavedId] of [[false,false],[true,false],[false,true]]) test(wrongAccount ? 'projeção não aceita confirmação de outra conta' : wrongSavedId ? 'fila exata corrige ID salvo por reconciliação antiga incorreta' : 'fila confirma envio já salvo na outbox e recupera ação normalizada sem reenviar', async () => {
  const conversationId='wa2:account-5511999999999:5511888888888@c.us';
  const outbox={action:{id:'action',idempotencyKey:'queue-key',status:'sent',providerMessageId:wrongSavedId?'old-wrong-provider':'provider',channel:'whatsapp2',payload:{brainActionId:'brain-action'}}};
  const updates=[];
  let sends=0;
  const supabase={rpc:async()=>({data:{success:true},error:null}),from(table){
    let update=null;
    const response=()=>({error:null,data:table==='whatsapp2_delivery_queue'?{id:'queue-key',conversation_id:conversationId,gateway_account_id:wrongAccount?'account-5521999999999':'account-5511999999999',status:'sent',provider_message_id:'provider'}:table==='brain_decision_actions'?(update?null:[{id:'brain-action',idempotency_key:'queue-key',status:'dispatch_uncertain'}]):{ai_auto_respond:false,stage_completed_rules:{status:'waiting_human',orchestration:{outbox}}}});
    const q={select:()=>q,eq:()=>q,in:()=>q,update:value=>{update=value;if(table==='brain_decision_actions')updates.push(value);return q;},maybeSingle:async()=>response(),then:resolve=>Promise.resolve(response()).then(resolve)};return q;
  }};
  await runDurableOutboxDispatcher({supabase,conversationId,outboxMap:outbox,runtime:{sendMetaTextMessage:async()=>{sends++;return {message_id:'unexpected'};}}});
  assert.equal(sends,0);
  assert.equal(updates.some(x=>x.status==='sent'&&x.provider_message_id==='provider'),!wrongAccount);
});
