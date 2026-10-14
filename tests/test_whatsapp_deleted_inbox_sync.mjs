import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {getWhatsAppConversationIdentityKey} from '../src/domain/entities/WhatsAppConversationIdentity.ts';
import account from '../src/domain/entities/whatsapp2-account-scope.cjs';

const source = fs.readFileSync(new URL('../src/presentation/components/chat/InstagramDirect.tsx', import.meta.url), 'utf8');
const pick = (from, to) => {
  const start = source.indexOf(from);
  const end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
};
const selectSource = pick('    const visibleIdentityGroups =', '    const merged =');
const reconcileSource = pick('    setWhatsApp2Conversations((currentRows) => {', '    // Transfere o histórico');
const accountId = 'account-5511999999999';
const fromId = (jid) => `wa2:${accountId}:${jid}`;
const at = '2026-10-14T11:00:00Z';

const groups = [
  {identityKey:'phone:5511999991111',gatewayRows:[{id:fromId('5511999991111@c.us')}],canonicalRows:[{id:fromId('5511999991111@c.us'),status:'archived'}]},
  {identityKey:'phone:5511999992222',gatewayRows:[],canonicalRows:[{id:fromId('5511999992222@c.us'),status:'active'}]},
  {identityKey:'phone:5511999993333',gatewayRows:[],canonicalRows:[{id:fromId('5511999993333@c.us'),status:'locked'}]},
];

test('somente grupos confirmados pelo WhatsApp aparecem com snapshot confiavel', () => {
  const result=vm.runInNewContext(selectSource+'\nvisibleIdentityGroups;', {
    identityGroups:groups,hasAuthoritativeGatewaySnapshot:true,
  });
  assert.deepEqual(Array.from(result,g=>g.identityKey),['phone:5511999991111']);
});

test('fallback conserva historico enquanto gateway nao pode confirmar exclusao', () => {
  const result=vm.runInNewContext(selectSource+'\nvisibleIdentityGroups;', {
    identityGroups:groups,hasAuthoritativeGatewaySnapshot:false,
  });
  assert.equal(result.length,3);
});

test('estado local recente nao ressuscita conversa excluida', () => {
  let result;
  const live={id:fromId('5511999991111@c.us'),providerId:'5511999991111@c.us',whatsappIdentityKey:groups[0].identityKey,lastMessageAt:at};
  const deleted={id:fromId('5511999992222@c.us'),providerId:'5511999992222@c.us',whatsappIdentityKey:groups[1].identityKey,lastMessageAt:at};
  vm.runInNewContext(reconcileSource,{
    setWhatsApp2Conversations:fn=>{result=fn([live,deleted]);},
    merged:[live],mergedByIdentity:new Map([[live.whatsappIdentityKey,live]]),
    mergedIdentityKeys:new Set([live.whatsappIdentityKey]),
    accountId,resolvedPhonesByChatId:new Map(),
    hasAuthoritativeGatewaySnapshot:true,
    getWhatsAppConversationIdentityKey,
    whatsappConversationBelongsToAccount:account.whatsappConversationBelongsToAccount,
    whatsappProviderIdFromConversationId:account.whatsappProviderIdFromConversationId,
    getMessageTimestampMs:value=>Date.parse(value)||0,
    Date,
  });
  assert.deepEqual(Array.from(result,x=>x.id),[live.id]);
});

test('realtime do Supabase para conversa nao confirmada apenas reconsulta WhatsApp', () => {
  const realtime=ts.transpile(pick('  const handleRealtimeWhatsApp2Conversation = useCallback(', '  // -------------------------------------------------------------\n  // SUPABASE REALTIME'), {target:ts.ScriptTarget.ES2022});
  let refreshes=0, updates=0;
  vm.runInNewContext(realtime+'\nhandleRealtimeWhatsApp2Conversation(input);',{
    useCallback:fn=>fn,
    activeWhatsAppAccountIdRef:{current:accountId},
    whatsapp2ProviderSnapshotReadyRef:{current:true},
    whatsapp2ConversationsRef:{current:[]},
    whatsapp2UnknownRealtimeCheckAtRef:{current:0},
    whatsappConversationBelongsToAccount:account.whatsappConversationBelongsToAccount,
    loadWhatsApp2Conversations:()=>{refreshes++;return Promise.resolve();},
    setWhatsApp2Conversations:()=>{updates++;},
    input:{id:fromId('5511999992222@c.us'),channel:'whatsapp2',status:'active',lastMessageAt:at},
    Date,
  });
  assert.equal(refreshes,1);
  assert.equal(updates,0);
});
