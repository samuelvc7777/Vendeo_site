import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const { resolveRaffleNumbersForFinalization }=require('../services/whatsapp2-gateway/finalization-raffle-numbers.cjs');
function database(payload,error=null){return {from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{stage_completed_rules:payload},error})})})})};}
test('finalização consulta somente números reais livres sem liberar reservas antigas',async()=>{
 const supabase=database({raffles:[{id:'a',status:'active',totalNumbers:4}],tickets:{a:[{number:1,status:'paid'},{number:2,status:'reserved',reservedAt:'2020-01-01'}]}});
 assert.equal(await resolveRaffleNumbersForFinalization({supabase,requestedRaffleId:'a'}),'03, 04');
});
test('finalização bloqueia dados ausentes, rifa inexistente, esgotamento e falha de consulta',async()=>{
 await assert.rejects(resolveRaffleNumbersForFinalization({supabase:null}),/indisponível/);
 await assert.rejects(resolveRaffleNumbersForFinalization({supabase:database({raffles:[]})}),/não encontrada/);
 const payload={raffles:[{id:'a',status:'active',totalNumbers:1}],tickets:{a:[{number:1,status:'reserved'}]}};
 await assert.rejects(resolveRaffleNumbersForFinalization({supabase:database(payload),requestedRaffleId:'b'}),/não encontrada/);
 await assert.rejects(resolveRaffleNumbersForFinalization({supabase:database(payload)}),/Não há números/);
 await assert.rejects(resolveRaffleNumbersForFinalization({supabase:database({},new Error('offline'))}),/offline/);
});
