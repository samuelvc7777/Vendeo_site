import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=fs.readFileSync('supabase/functions/api/index.ts','utf8');
const a=source.indexOf('          const { data: activationSchedule, error: activationScheduleError }');
const b=source.indexOf('          // Ativação atômica via RPC:',a);
assert.ok(a>0&&b>a);
for(const status of ['completed_waiting_manual','ready_for_transition','active']){
 const query={select(){return this},eq(){return this},async maybeSingle(){return {data:{stage_completed_rules:{schedule_status:status}},error:null}}};
 const result=await vm.runInNewContext('(async()=>{'+source.slice(a,b)+'return null;})()', {supabase:{from:()=>query},conversationId:'test',Response,corsHeaders:{}});
 if(status==='active')assert.equal(result,null);else{assert.equal(result.status,409);const body=await result.json();assert.equal(body.code,'schedule_completed_waiting_manual');assert.equal(body.isEnabled,false);}
}
console.log('Cronogramas concluídos bloqueiam a ativação antes da RPC; cronogramas ativos continuam.');
