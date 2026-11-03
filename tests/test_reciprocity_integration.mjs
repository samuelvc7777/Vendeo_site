import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgliteSupabase} from './helpers/pglite-supabase.mjs';
import {processReciprocityAutomaticEvents} from '../supabase/functions/api/reciprocity_automatic.ts';
import {processReciprocityQueue,handleReciprocityApi} from '../supabase/functions/api/reciprocity_runtime.ts';

const scope={scopeId:'authorized',accountIds:['whatsapp2:account-a']};
const evaluation={participation:'alta',curiosity:'moderada',summary:'Troca com iniciativa e atenção.',reasons:['O contato retoma a pergunta.'],evolution:'indeterminada',limitations:[],evidence:[{messageId:'contact-1',quote:'E você, Larissa?',reason:'Pergunta dirigida à Larissa.'}]};

test('marco persistido atravessa fila e provedor até consulta autorizada com recorte estável da conversa canônica',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
      create table instagram_conversations(id text primary key,stage_completed_rules jsonb,current_stage_id text);
      create table instagram_messages(id text primary key,conversation_id text,text text,is_mine boolean,timestamp timestamptz,created_at timestamptz,media_type text,channel text);
      create table chat_stages(id text primary key,schedule_id text,goals jsonb);
      create table conversation_channel_identities(conversation_id text,status text,channel text,external_account_id text);
      insert into chat_stages values('stage_1_conexao','schedule_sales','[{"id":"greeting"},{"id":"city"}]');
      insert into instagram_conversations values('canonical','{}','stage_1_conexao'),('foreign','{}','stage_1_conexao');
      insert into conversation_channel_identities values('canonical','transferred','whatsapp2','account-a'),('canonical','active','instagram','instagram-a'),('foreign','active','whatsapp2','account-b');
      insert into instagram_messages values
        ('larissa-1','canonical','Como você está?',true,'2026-11-01T10:00:00Z','2026-11-01T10:00:00Z',null,'instagram'),
        ('contact-1','canonical','Estou bem. E você, Larissa?',false,'2026-11-01T10:01:00Z','2026-11-01T10:01:00Z',null,'whatsapp2'),
        ('foreign-1','foreign','CONTEUDO DE OUTRA CONTA',false,'2026-11-01T10:00:00Z','2026-11-01T10:00:00Z',null,'whatsapp2');`);
    for(const name of ['20261103125431_reciprocity_analysis.sql','20261103130715_reciprocity_automatic_events.sql'])await db.exec(await readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8'));
    const supabase=pgliteSupabase(db),calls=[];
    const fetch=async(url,init)=>{
      calls.push({url,body:init.body?JSON.parse(init.body):null});
      return new Response(JSON.stringify(url.includes('/models/')?{id:'gpt-6-luna'}:{status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(evaluation)}]}],usage:{input_tokens:150,output_tokens:80}}));
    };
    const options={fetch,validatedModels:['gpt-6-luna']};
    const automatic=()=>processReciprocityAutomaticEvents({supabase,scopes:[scope],openAiKey:'fake',providerOptions:options});
    assert.deepEqual(await automatic(),{enqueued:0,failed:0,deferred:0});
    await db.query(`update instagram_conversations set stage_completed_rules='{"completed_goals":["greeting"]}' where id='canonical'`);
    assert.deepEqual(await automatic(),{enqueued:0,failed:0,deferred:0});
    await db.query(`update instagram_conversations set stage_completed_rules='{"completed_goals":["greeting","city"]}'`);
    assert.deepEqual(await automatic(),{enqueued:1,failed:0,deferred:0});
    await db.query(`insert into instagram_messages values('later','canonical','Mensagem posterior ao recorte',false,'2026-11-01T10:02:00Z','2026-11-01T10:02:00Z',null,'whatsapp2')`);
    assert.deepEqual(await processReciprocityQueue({supabase,scopes:[scope],openAiKey:'fake',providerOptions:options}),{processed:true});
    assert.deepEqual(await automatic(),{enqueued:0,failed:0,deferred:0});
    assert.deepEqual(await processReciprocityQueue({supabase,scopes:[scope],openAiKey:'fake',providerOptions:options}),{processed:false});
    const analysisCalls=calls.filter(call=>call.url.endsWith('/responses'));
    assert.equal(analysisCalls.length,1);
    const history=analysisCalls[0].body.input[1].content;
    assert.match(history,/Como você está/);assert.match(history,/E você, Larissa/);
    assert.doesNotMatch(history,/Mensagem posterior|CONTEUDO DE OUTRA CONTA/);
    const tokenHash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('operator-key')))].map(value=>value.toString(16).padStart(2,'0')).join('');
    const get=id=>handleReciprocityApi({request:new Request(`https://api.test/operator/reciprocity?conversationId=${id}`,{headers:{'x-reciprocity-key':'operator-key'}}),path:'/operator/reciprocity',supabase,scopesJson:JSON.stringify([{...scope,tokenHash}]),providerOptions:{...options,apiKey:'fake'},corsHeaders:{}});
    const response=await get('canonical');assert.equal(response.status,200);
    const view=await response.json();
    assert.equal(view.state,'completed');assert.equal(view.attempts.length,1);
    assert.deepEqual(view.latestCompleted.result,evaluation);
    assert.equal(view.latestCompleted.coverage.firstMessageId,'larissa-1');
    assert.equal(view.latestCompleted.coverage.lastMessageId,'contact-1');assert.equal(view.latestCompleted.coverage.messageCount,2);
    assert.equal(view.latestCompleted.usage.inputTokens,150);
    assert.equal(view.latestCompleted.messages,undefined);assert.equal(view.latestCompleted.leaseToken,undefined);
    assert.equal((await get('foreign')).status,404);
  }finally{await db.close();}
});
