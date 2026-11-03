import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('fila durável fixa histórico, deduplica concorrência e só conclui com lease vigente',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table instagram_conversations(id text primary key, stage_completed_rules jsonb);
      create table instagram_messages(id text primary key, conversation_id text, text text, is_mine boolean, timestamp timestamptz, created_at timestamptz, media_type text, audio_transcript text);
      create table chat_stages(id text primary key, schedule_id text, goals jsonb);
      insert into chat_stages values('stage_1_conexao','schedule_sales','[{"id":"g1","enabled":true},{"id":"g2","enabled":true}]');
      insert into instagram_conversations values('a','{"completed_goals":["g1","g2"]}');
      insert into instagram_messages values('m1','a','Oi',false,'2026-11-01','2026-11-01',null,null);`);
    await db.exec(await readFile(new URL('../supabase/migrations/20261103125431_reciprocity_analysis.sql',import.meta.url),'utf8'));
    const enqueue=()=>db.query(`select enqueue_reciprocity_analysis('s','a','manual','{"model":"gpt-6-luna","reasoning":"low"}') as a`);
    const first=(await enqueue()).rows[0].a;
    const second=(await enqueue()).rows[0].a;
    assert.equal(first.id,second.id);
    await db.exec(`insert into instagram_messages values('m2','a','Depois',true,'2026-11-02','2026-11-02',null,null)`);
    const claimed=(await db.query(`select claim_reciprocity_analysis('lease-1') as a`)).rows[0].a;
    assert.equal(claimed.messages.length,1); assert.equal(claimed.messages[0].id,'m1');
    assert.equal((await db.query(`select claim_reciprocity_analysis('lease-2') as a`)).rows[0].a,null);
    assert.equal((await db.query(`select finish_reciprocity_analysis($1,'wrong','completed','{}') as ok`,[first.id])).rows[0].ok,false);
    assert.equal((await db.query(`select finish_reciprocity_analysis($1,'lease-1','completed','{}') as ok`,[first.id])).rows[0].ok,true);
    await db.exec(`update instagram_conversations set stage_completed_rules='{"completed_goals":[],"objective_progress":{},"chat_progress":{"completedGoalIds":["g1","g2"]},"orchestration":{"completedGoalIds":["g1","g2"]}}' where id='a'`);
    assert.equal((await db.query(`select reciprocity_checklist_complete('a') as ok`)).rows[0].ok,false,'espelho antigo não sobrepõe autoridade vazia');
    await db.exec(`set role anon`);
    await assert.rejects(db.query('select * from reciprocity_attempts'),/permission denied/);
    await assert.rejects(db.query(`select enqueue_reciprocity_analysis('s','a','manual','{}')`),/permission denied/);
  } finally {await db.close();}
});
