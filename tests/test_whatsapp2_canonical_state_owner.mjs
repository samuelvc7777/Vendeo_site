import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
let selectWhatsApp2StateOwner;
try { ({selectWhatsApp2StateOwner}=require('../src/domain/entities/whatsapp2-state-owner.cjs')); } catch {}
const source=fs.readFileSync(new URL('../src/presentation/components/chat/InstagramDirect.tsx',import.meta.url),'utf8');
const begin=source.indexOf('      const canonical =',source.indexOf('const merged = identityGroups.map'));
const end=source.indexOf('      const id =',begin);
assert.ok(begin>0&&end>begin);
const selection=source.slice(begin,end).replace(/: any/g,'');
function select(rows){return vm.runInNewContext(`(()=>{${selection};return canonical;})()`,{
 canonicalCandidates:rows,selectWhatsApp2StateOwner,getMessageTimestampMs:date=>Date.parse(date)||0,
});}
test('resposta nova no alias não troca o chat habilitado por um snapshot desligado',()=>{
 const active={id:'wa2:account-5511999999999:123@lid',ai_auto_respond:true,stage_completed_rules:{status:'active'},last_message_at:'2026-10-07T15:35:11Z'};
 const snapshot={id:'wa2:account-5511999999999:5511888888888@c.us',ai_auto_respond:false,last_message_at:'2026-10-07T15:36:39Z'};
 assert.equal(select([snapshot,active]).id,active.id);
});
test('mantém atendimento pelo telefone quando o snapshot LID fica mais recente',()=>{
 const active={id:'wa2:account-5511999999999:5511888888888@c.us',ai_auto_respond:true,current_stage_id:'stage-1',last_message_at:'2026-10-07T15:35:11Z'};
 const snapshot={id:'wa2:account-5511999999999:123@lid',ai_auto_respond:false,last_message_at:'2026-10-07T15:36:39Z'};
 assert.equal(select([snapshot,active]).id,active.id);
});
test('preserva desligamento explícito do atendimento',()=>{
 const disabled={id:'wa2:account-5511999999999:123@lid',ai_auto_respond:false,autopilot_status:'disabled',last_message_at:'2026-10-07T15:35:11Z'};
 const snapshot={id:'wa2:account-5511999999999:5511888888888@c.us',ai_auto_respond:false,last_message_at:'2026-10-07T15:36:39Z'};
 assert.equal(select([snapshot,disabled]).id,disabled.id);
});
