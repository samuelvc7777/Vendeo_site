import test from 'node:test';
import assert from 'node:assert/strict';
const moduleUrl=new URL('../supabase/functions/api/reciprocity_automatic.ts',import.meta.url);
const configuration={model:'gpt-6-luna',reasoning:'low'};
function fixture({denied=false,preflightFailure=false}={}){
 const events=[{conversation_id:'conv'}];const calls=[];const receipts=new Map();
 const supabase={
  from(table){const filters={};const chain={select(){return chain;},eq(k,v){filters[k]=v;return chain;},async maybeSingle(){
   if(table==='instagram_conversations')return {data:{id:filters.id},error:null};
   if(table==='reciprocity_settings')return {data:configuration,error:null};
   return {data:null,error:null};
  },then(resolve){return Promise.resolve({data:[],error:null}).then(resolve);}};return chain;},
  async rpc(name,args){calls.push({name,args});
   if(name==='pending_reciprocity_automatic_events')return {data:receipts.has(args.p_scope_id)?[]:events,error:null};
   if(name==='reciprocity_checklist_complete')return {data:true,error:null};
   if(name==='enqueue_reciprocity_automatic_event'){const attempt={id:`a-${args.p_scope_id}`,state:args.p_error?'failed':'queued'};receipts.set(args.p_scope_id,attempt);return {data:attempt,error:null};}
   throw Error(name);
  }
 };
 const scopes=[{scopeId:'s',conversationIds:denied?['other']:['conv']}];
 let requests=0;const transport=async(url)=>{requests++;assert.match(url,/\/models\/gpt-6-luna$/);return preflightFailure?new Response('{}',{status:503}):Response.json({id:'gpt-6-luna'});};
 return {supabase,scopes,calls,receipts,providerOptions:{fetch:transport},requests:()=>requests};
}
test('worker automático autoriza antes do preflight e usa configuração efetiva ao agendar sem avaliar mensagens',async()=>{
 const {processReciprocityAutomaticEvents}=await import(moduleUrl);const f=fixture();
 const result=await processReciprocityAutomaticEvents({...f,openAiKey:'test'});
 assert.equal(result.enqueued,1);assert.equal(f.requests(),1);
 const call=f.calls.find(c=>c.name==='enqueue_reciprocity_automatic_event');assert.deepEqual(call.args.p_configuration,configuration);assert.equal(call.args.p_error,null);
 await processReciprocityAutomaticEvents({...f,openAiKey:'test'});assert.equal(f.requests(),1,'recibo impede novo preflight e agendamento');
});
test('escopo revogado e ausência de configuração não enviam chamadas ou consomem eventos',async()=>{
 const {processReciprocityAutomaticEvents}=await import(moduleUrl);const denied=fixture({denied:true});
 await processReciprocityAutomaticEvents({...denied,openAiKey:'test'});assert.equal(denied.requests(),0);assert.equal(denied.receipts.size,0);
 const missing=fixture();await processReciprocityAutomaticEvents({...missing,openAiKey:''});assert.equal(missing.calls.length,0);assert.equal(missing.requests(),0);
});
test('falha de disponibilidade vira primeira tentativa recuperável sem trocar modelo nem repetir no cron seguinte',async()=>{
 const {processReciprocityAutomaticEvents}=await import(moduleUrl);const f=fixture({preflightFailure:true});
 const result=await processReciprocityAutomaticEvents({...f,openAiKey:'test'});assert.equal(result.failed,1);
 assert.equal(f.receipts.get('s').state,'failed');const call=f.calls.find(c=>c.name==='enqueue_reciprocity_automatic_event');assert.match(call.args.p_error,/modelo selecionado/);
 await processReciprocityAutomaticEvents({...f,openAiKey:'test'});assert.equal(f.requests(),1);
});
test('mesmo evento pode agendar análises independentes para dois escopos explicitamente autorizados',async()=>{
 const {processReciprocityAutomaticEvents}=await import(moduleUrl);const f=fixture();f.scopes.push({scopeId:'second',conversationIds:['conv']});
 const result=await processReciprocityAutomaticEvents({...f,openAiKey:'test'});assert.equal(result.enqueued,2);assert.equal(f.receipts.size,2);
});
