import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {ReciprocityService} from '../supabase/functions/api/reciprocity_service.ts';
import {handleReciprocityRequest} from '../supabase/functions/api/reciprocity_routes.ts';
const scope={scopeId:'a',allConversations:true};
class Store{
  configs=new Map(); attempts=[];
  async settings(id){return structuredClone(this.configs.get(id)||{model:'gpt-6-luna',reasoning:'low'});}
  async saveSettings(id,configuration){this.configs.set(id,structuredClone(configuration));return configuration;}
  async authorize(s,id){return s.scopeId==='a'&&id==='chat-a';}
  async eligible(){return true;}
  async enqueue(scopeId,conversationId,reason,configuration){const a={id:'1',scopeId,conversationId,reason,configuration:structuredClone(configuration),state:'queued',messages:[],createdAt:'2026-11-03',criteriaVersion:'reciprocity-v1'};this.attempts.push(a);return a;}
  async list(){return this.attempts;}
}
test('configuração padrão é Luna baixo e cada uma das nove combinações é persistida somente no escopo autenticado',async()=>{
  const store=new Store(); const checked=[];
  const service=new ReciprocityService(store,{async preflight(c){checked.push(c);}});
  assert.deepEqual(await service.getSettings(scope),{model:'gpt-6-luna',reasoning:'low'});
  for(const model of ['gpt-6-luna','gpt-6.1-terra','gpt-6.1-sol'])for(const reasoning of ['low','medium','high']){
    assert.deepEqual(await service.saveSettings(scope,{model,reasoning}),{model,reasoning});
    assert.deepEqual(await service.getSettings(scope),{model,reasoning});
  }
  assert.equal(checked.length,9);
  assert.deepEqual(await service.getSettings({scopeId:'b'}),{model:'gpt-6-luna',reasoning:'low'});
});
test('modelo indisponível e combinação inválida não alteram configuração anterior',async()=>{
  const store=new Store();
  const service=new ReciprocityService(store,{async preflight(){throw new Error('Modelo indisponível');}});
  await assert.rejects(service.saveSettings(scope,{model:'gpt-6.1-sol',reasoning:'high'}),/indisponível/);
  assert.deepEqual(await service.getSettings(scope),{model:'gpt-6-luna',reasoning:'low'});
  await assert.rejects(service.saveSettings(scope,{model:'outro-modelo',reasoning:'high'}),/inválid/);
  assert.equal(store.configs.size,0);
});
test('mudar configurações não altera snapshot de execução nem refaz avaliações existentes',async()=>{
  const store=new Store();const service=new ReciprocityService(store,{async preflight(){}});
  await service.request(scope,'chat-a');
  await service.saveSettings(scope,{model:'gpt-6.1-terra',reasoning:'high'});
  assert.deepEqual(store.attempts[0].configuration,{model:'gpt-6-luna',reasoning:'low'});
  assert.equal(store.attempts.length,1);
});
test('GET/PUT settings derivam escopo da chave e não aceitam escopo do corpo',async()=>{
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('secret')))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const config=JSON.stringify([{...scope,tokenHash:hash}]);
  const store=new Store(), service=new ReciprocityService(store,{async preflight(){}});
  const call=(method,body,key='secret')=>handleReciprocityRequest({request:new Request('https://api.test/operator/reciprocity/settings',{method,headers:{'x-reciprocity-key':key},...(body?{body:JSON.stringify(body)}:{})}),path:'/operator/reciprocity/settings',scopesJson:config,service,corsHeaders:{}});
  assert.deepEqual(await (await call('GET')).json(),{model:'gpt-6-luna',reasoning:'low'});
  assert.equal((await call('PUT',{scopeId:'b',model:'gpt-6.1-sol',reasoning:'medium'})).status,200);
  assert.deepEqual(await service.getSettings(scope),{model:'gpt-6.1-sol',reasoning:'medium'});
  assert.deepEqual(await service.getSettings({scopeId:'b'}),{model:'gpt-6-luna',reasoning:'low'});
  assert.equal((await call('GET',null,'bad')).status,401);
  assert.equal((await call('PUT',{model:'other',reasoning:'medium'})).status,400);
});
test('persistência aceita nove combinações e bloqueia modelos inválidos e acesso público às configurações',async()=>{
  const db=new PGlite();
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table instagram_conversations(id text primary key,stage_completed_rules jsonb);
      create table instagram_messages(id text primary key,conversation_id text,text text,is_mine boolean,timestamp timestamptz,created_at timestamptz,media_type text,audio_transcript text);
      create table chat_stages(id text primary key,schedule_id text,goals jsonb);`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261103125431_reciprocity_analysis.sql',import.meta.url),'utf8'));
    for(const model of ['gpt-6-luna','gpt-6.1-terra','gpt-6.1-sol'])for(const reasoning of ['low','medium','high']){
      await db.query('insert into reciprocity_settings(scope_id,model,reasoning) values($1,$2,$3)',[model+reasoning,model,reasoning]);
    }
    assert.equal((await db.query('select count(*)::integer as count from reciprocity_settings')).rows[0].count,9);
    await assert.rejects(db.query("insert into reciprocity_settings(scope_id,model,reasoning) values('bad','other','low')"),/check constraint/);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from reciprocity_settings'),/permission denied/);
    await assert.rejects(db.query("update reciprocity_settings set model='gpt-6.1-sol'"),/permission denied/);
  }finally{await db.close();}
});
