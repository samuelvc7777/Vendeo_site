import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const migration=name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8');
const configuration={model:'gpt-6-luna',reasoning:'low'};
async function database(){
 const db=new PGlite();
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create table instagram_conversations(id text primary key,stage_completed_rules jsonb,current_stage_id text);
 create table instagram_messages(id text primary key,conversation_id text,text text,is_mine boolean,timestamp timestamptz,created_at timestamptz,media_type text);
 create table chat_stages(id text primary key,schedule_id text,goals jsonb); create table conversation_channel_identities(conversation_id text,status text,channel text,external_account_id text);
 insert into chat_stages values('stage_1_conexao','schedule_sales','[{"id":"g1"},{"id":"g2","required":false},{"id":"disabled","enabled":false}]');
 insert into instagram_conversations values('old','{"completed_goals":["g1","g2"]}','later'),('conv','{}','stage_1_conexao');
 insert into instagram_messages values('m','conv','Oi',false,now(),now(),null);`);
 await db.exec(await migration('20261103125431_reciprocity_analysis.sql'));
 await db.exec(await migration('20261103130715_reciprocity_automatic_events.sql'));
 return db;
}
const count=async db=>(await db.query('select count(*)::int as n from reciprocity_milestone_events')).rows[0].n;
const complete=db=>db.query(`update instagram_conversations set stage_completed_rules='{"completed_goals":["g1","g2"]}',current_stage_id='later' where id='conv'`);
const enqueue=(db,scope='s',error=null)=>db.query(`select enqueue_reciprocity_automatic_event($1,'conv',$2::jsonb,$3) as a`,[scope,JSON.stringify(configuration),error]);
test('gatilho só registra conclusão total persistida e não faz backfill ou favorece espelhos antigos',async()=>{
 const db=await database();try{
 assert.equal(await count(db),0);
 await db.query(`update instagram_conversations set stage_completed_rules=stage_completed_rules||'{"orchestration":{"active_cycle_at":"now"}}' where id='old'`);
 assert.equal(await count(db),0);
 await db.query(`update instagram_conversations set stage_completed_rules='{"completed_goals":["g1"],"objective_progress":{"g2":{"status":"skipped"}}}' where id='conv'`);
 assert.equal(await count(db),0,'opcional habilitado precisa concluir');
 await db.query(`update instagram_conversations set stage_completed_rules='{"completed_goals":[],"objective_progress":{},"chat_progress":{"completedGoalIds":["g1","g2"]},"orchestration":{"completedGoalIds":["g1","g2"]}}' where id='conv'`);
 assert.equal(await count(db),0,'campos oficiais vazios não usam espelho antigo');
 await db.query(`begin`);await complete(db);assert.equal(await count(db),1);await db.query('rollback');assert.equal(await count(db),0);
 await complete(db);assert.equal(await count(db),1,'avanço simultâneo de etapa mantém evento');
 const event=(await db.query('select * from reciprocity_milestone_events')).rows[0];assert.deepEqual(event.goals.map(g=>g.id),['g1','g2','disabled']);
 await db.query(`update instagram_conversations set stage_completed_rules='{}' where id='conv'`);await complete(db);assert.equal(await count(db),1);
 await db.query(`update instagram_conversations set stage_completed_rules=stage_completed_rules||'{"orchestration":{}}' where id='conv'`);assert.equal(await count(db),1);
 await db.query('set role anon');await assert.rejects(db.query('select * from reciprocity_milestone_events'),/permission denied/);
 }finally{await db.close();}
});
test('configuração dinâmica inclui novos objetivos e catálogo vazio não conclui',async()=>{
 const db=await database();try{
 await db.query(`update chat_stages set goals='[]'`);await complete(db);assert.equal(await count(db),0);
 await db.query(`update chat_stages set goals='[{"id":"custom","enabled":true}]'`);
 await db.query(`update instagram_conversations set stage_completed_rules='{"objective_progress":{"custom":{"status":"completed"}}}' where id='conv'`);assert.equal(await count(db),1);
 }finally{await db.close();}
});
test('enqueue e recibo são atômicos por escopo inclusive quando análise manual ativa satisfaz evento',async()=>{
 const db=await database();try{
 await complete(db);
 const manual=(await db.query(`select enqueue_reciprocity_analysis('s','conv','manual',$1::jsonb) as a`,[JSON.stringify(configuration)])).rows[0].a;
 await db.query('begin');const queued=(await enqueue(db)).rows[0].a;assert.equal(queued.id,manual.id);await db.query('rollback');
 assert.equal((await db.query('select count(*)::int n from reciprocity_automatic_receipts')).rows[0].n,0,'rollback não deixa ack órfão');
 const first=(await enqueue(db)).rows[0].a;assert.equal(first.id,manual.id);
 await db.query(`update reciprocity_attempts set state='completed' where id=$1`,[first.id]);
 const replay=(await enqueue(db)).rows[0].a;assert.equal(replay.id,manual.id,'replay após conclusão manual não cria chamada automática');
 assert.equal((await db.query('select count(*)::int n from reciprocity_attempts')).rows[0].n,1);
 const other=(await enqueue(db,'other')).rows[0].a;assert.notEqual(other.id,manual.id,'outro escopo explicitamente autorizado possui resultado próprio');
 assert.equal((await db.query(`select count(*)::int n from pending_reciprocity_automatic_events('s',20)`)).rows[0].n,0);
 await db.query('set role authenticated');await assert.rejects(enqueue(db),/permission denied/);
 }finally{await db.close();}
});
test('falha inicial vira tentativa recuperável sem repetir automaticamente nem alterar manual ativa',async()=>{
 const db=await database();try{
 await complete(db);const failed=(await enqueue(db,'s','Modelo indisponível.')).rows[0].a;assert.equal(failed.state,'failed');assert.equal(failed.error,'Modelo indisponível.');
 assert.equal((await enqueue(db,'s')).rows[0].a.id,failed.id);
 const manual=(await db.query(`select enqueue_reciprocity_analysis('manual-scope','conv','manual',$1::jsonb) as a`,[JSON.stringify(configuration)])).rows[0].a;
 const associated=(await enqueue(db,'manual-scope','Modelo indisponível.')).rows[0].a;assert.equal(associated.id,manual.id);assert.equal(associated.state,'queued');
 }finally{await db.close();}
});

test('seleção de eventos filtra escopo antes do limite e não mistura contas ou identidades pendentes',async()=>{
 const db=await database();try{
 await complete(db);
 const scope=async value=>(await db.query(`select conversation_id from pending_reciprocity_automatic_events('s',1,$1::jsonb)`,[JSON.stringify(value)])).rows;
 assert.deepEqual(await scope({conversationIds:['other']}),[]);
 assert.deepEqual(await scope({conversationIds:['conv']}),[{conversation_id:'conv'}]);
 await db.query(`insert into conversation_channel_identities values('conv','pending_verification','whatsapp2','a')`);
 assert.deepEqual(await scope({accountIds:['whatsapp2:a']}),[]);
 await db.query(`update conversation_channel_identities set status='transferred'`);
 assert.deepEqual(await scope({accountIds:['whatsapp2:a']}),[{conversation_id:'conv'}]);
 assert.deepEqual(await scope({accountIds:['instagram:a']}),[]);
 }finally{await db.close();}
});
