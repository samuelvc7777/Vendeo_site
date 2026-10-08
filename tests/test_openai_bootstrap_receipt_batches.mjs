import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import path from 'node:path';
const source = fs.readFileSync(path.resolve(process.env.BOOTSTRAP_TEST_SOURCE_ROOT || '.', 'supabase/functions/api/openai_conversation_runtime.ts'),'utf8');

function fixture({ total = 291, synced = 0, receiptFailure = false, longIds = false } = {}) {
  const rows = Array.from({length: total},(_,i)=>({id:`false_chat@lid_${String(i).padStart(8,'0')}_${'a'.repeat(longIds ? 220 : 40)}`,text:`mensagem ${i}`,timestamp:'2026-10-08T13:00:00Z',sender_id:'them'}));
  const receipts = new Map(rows.slice(0,synced).map(row=>[row.id,{provider_message_id:row.id,openai_item_id:'synced-'+row.id,synced_at:'2026-10-08T12:00:00Z'}]));
  const receiptQueries = [], created = [], updates = [];
  const supabase = { from(table) {
    let write = null, offset = 0, end = 499, ids = [];
    const query = {
      select(){return this}, eq(){return this}, order(){return this},
      maybeSingle(){return Promise.resolve({data:{bootstrap_status:'failed'}})},
      update(value){write=value;return this}, range(a,b){offset=a;end=b;return this},
      in(_field,value){ids=value;return this},
      upsert(values){for(const row of values)receipts.set(row.provider_message_id,row);return Promise.resolve({error:null})},
      then(resolve,reject){
        let result;
        if(table==='instagram_messages') result={data:rows.slice(offset,end+1),error:null};
        else if(table==='openai_message_receipts') {
          const length=new URLSearchParams({provider_message_id:`in.(${ids.join(',')})`}).toString().length;
          receiptQueries.push({count:ids.length,length});
          result=receiptFailure||length>8000 ? {data:null,error:{message:'TypeError: error sending request'}} : {data:ids.map(id=>receipts.get(id)).filter(Boolean),error:null};
        } else {updates.push(write);result={error:null};}
        return Promise.resolve(result).then(resolve,reject);
      },
    };return query;
  }};
  const client = { conversations:{ items:{ async create(_conversation,{items}){
    created.push(...items);return {data:items.map((_item,i)=>({id:'item-'+created.length+'-'+i}))};
  }}}};
  const context=vm.createContext({exports:{},process,console,URLSearchParams,require:()=>({getDefaultOpenAIClient:()=>client})});
  vm.runInContext(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText,context);
  const run=()=>context.exports.bootstrapOpenAiConversationHistory({supabase,conversationId:'synthetic',openAiConversationId:'synthetic-openai'});
  return {run,created,receiptQueries,updates};
}

test('reset/bootstrap com 291 mensagens lê recibos sem ultrapassar limite da requisição',async()=>{
  const f=fixture();const result=await f.run();
  assert.equal(result.messageCount,291);assert.equal(f.created.length,291);
  assert.ok(f.receiptQueries.length>1);
  assert.ok(f.receiptQueries.every(q=>q.count<=50&&q.length<=6000));
});

test('IDs longos reduzem o lote e recibos existentes não são sincronizados de novo',async()=>{
  const f=fixture({total:200,synced:150,longIds:true});
  const result=await f.run();assert.equal(result.messageCount,200);assert.equal(f.created.length,50);
  assert.ok(f.receiptQueries.every(q=>q.length<=6000));
});

test('mais de uma página mantém o histórico completo e a ordem',async()=>{
  const f=fixture({total:530});const result=await f.run();
  assert.equal(result.messageCount,530);assert.equal(f.created.length,530);
  assert.match(f.created[0].content[0].text,/mensagem 0$/);
  assert.match(f.created[529].content[0].text,/mensagem 529$/);
});

test('retomada preserva recibos e não cria novamente itens já sincronizados',async()=>{
  const f=fixture({total:291});await f.run();
  const count=f.created.length;
  const resumed=await f.run();
  assert.equal(resumed.messageCount,291);assert.equal(f.created.length,count);
});

test('falha real de acesso interrompe antes de gravar histórico no provedor',async()=>{
  const f=fixture({receiptFailure:true});await assert.rejects(f.run(),/openai_bootstrap_receipts_read_failed/);
  assert.equal(f.created.length,0);assert.equal(f.updates.at(-1).bootstrap_status,'failed');
});
