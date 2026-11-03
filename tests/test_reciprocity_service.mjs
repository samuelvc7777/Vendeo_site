import test from 'node:test';
import assert from 'node:assert/strict';
import { ReciprocityService } from '../supabase/functions/api/reciprocity_service.ts';

class MemoryStore {
  attempts = [];
  messages = [{ id: 'm1', role: 'contact', text: 'E você, gosta de praia?', at: '2026-11-01T10:00:00Z', mediaMissing: false }];
  async authorize(scope, id) { return id === 'chat-a' && scope.scopeId === 'a'; }
  async eligible() { return true; }
  async settings() { return { model: 'gpt-6-luna', reasoning: 'low' }; }
  async list(scope, id) { return this.attempts.filter(a => a.scopeId === scope && a.conversationId === id); }
  async enqueue(scope, conversationId, reason, configuration) {
    const active = this.attempts.find(a => a.scopeId === scope && a.conversationId === conversationId && ['queued','processing'].includes(a.state));
    if (active) return active;
    const attempt = { id: String(this.attempts.length + 1), scopeId: scope, conversationId, reason, configuration, state: 'queued', messages: structuredClone(this.messages), createdAt: '2026-11-03T12:00:00Z', criteriaVersion: 'reciprocity-v1' };
    this.attempts.unshift(attempt);
    return attempt;
  }
  async claim() { const a = this.attempts.find(a => a.state === 'queued'); if (!a) return null; a.state = 'processing'; return structuredClone(a); }
  async finish(id, state, values) { const a = this.attempts.find(a => a.id === id); Object.assign(a, {state}, values); return true; }
}
const scope = { scopeId: 'a', allConversations: true };
const result = {
  participation: 'moderada', curiosity: 'alta', summary: 'O contato pergunta sobre a Larissa.',
  reasons: ['Pergunta espontânea sobre preferência.'], evolution: 'indeterminada',
  limitations: ['Só uma mensagem disponível.'], evidence: [{messageId: 'm1', quote: 'gosta de praia?', reason: 'Curiosidade espontânea.'}],
};
const provider = { async preflight() {}, async evaluate() { return { result, usage: {inputTokens: 100, outputTokens: 50}, estimatedCostUsd: null, durationMs: 20 }; } };

test('primeira solicitação enfileira e consulta sem expor snapshot; execução preserva o recorte e produz evidência verificável', async () => {
  const store = new MemoryStore();
  const service = new ReciprocityService(store, provider);
  const queued = await service.request(scope, 'chat-a', 'manual');
  assert.equal(queued.attempt.state, 'queued');
  assert.equal(queued.attempt.messages, undefined);
  store.messages.push({id:'m2', role:'contact', text:'Nova mensagem', at:'2026-11-03T13:00:00Z', mediaMissing:false});
  await service.processOne([scope]);
  const view = await service.view(scope, 'chat-a');
  assert.equal(view.state, 'completed');
  assert.equal(view.latestCompleted.result.curiosity, 'alta');
  assert.equal(view.latestCompleted.coverage.lastMessageId, 'm1');
  assert.equal(view.latestCompleted.coverage.messageCount, 1);
  assert.equal(view.latestCompleted.messages, undefined);
});

test('consulta e execução recusam outra conta inclusive trocando IDs', async () => {
  const service = new ReciprocityService(new MemoryStore(), provider);
  await assert.rejects(service.request({scopeId:'b'}, 'chat-a'), {status:404});
  await assert.rejects(service.view(scope, 'chat-b'), {status:404});
});
test('checklist incompleto não chama provedor nem enfileira', async () => {
  const store = new MemoryStore(); store.eligible = async () => false;
  const service = new ReciprocityService(store, {async preflight(){assert.fail('não deve chamar OpenAI');}});
  await assert.rejects(service.request(scope,'chat-a'), {status:409});
  assert.equal(store.attempts.length, 0);
});
test('cliques concorrentes geram uma chamada e mantêm resultado anterior durante nova avaliação e falha', async () => {
  const store = new MemoryStore(); let calls=0;
  const service = new ReciprocityService(store, {...provider, async evaluate(...args){calls++; if(calls===2) throw new Error('Modelo indisponível'); return provider.evaluate(...args);}});
  const first = await Promise.all([service.request(scope,'chat-a'),service.request(scope,'chat-a')]);
  assert.equal(first[0].attempt.id,first[1].attempt.id);
  await Promise.all([service.processOne([scope]),service.processOne([scope])]);
  assert.equal(calls,1);
  await service.request(scope,'chat-a','reevaluation');
  assert.equal((await service.view(scope,'chat-a')).latestCompleted.id,'1');
  await service.processOne([scope]);
  const view=await service.view(scope,'chat-a');
  assert.equal(view.state,'failed'); assert.equal(view.latestCompleted.id,'1');
  assert.equal(view.attempts.length,2);
});
test('evidência inventada não vira resultado concluído', async () => {
  const store=new MemoryStore();
  const service=new ReciprocityService(store,{...provider,async evaluate(){return {result:{...result,evidence:[{messageId:'outro-chat',quote:'oi',reason:'fake'}]},usage:{inputTokens:1,outputTokens:1},estimatedCostUsd:null,durationMs:1};}});
  await service.request(scope,'chat-a'); await service.processOne([scope]);
  const view=await service.view(scope,'chat-a'); assert.equal(view.latestCompleted,null); assert.equal(view.state,'failed');
  assert.equal(view.attempts[0].usage.inputTokens,1);
});
test('worker recusa escopo revogado antes de chamar modelo',async()=>{
  let called=false;
  const store=new MemoryStore(); const service=new ReciprocityService(store,{...provider,async evaluate(){called=true;return provider.evaluate();}});
  await service.request(scope,'chat-a'); await service.processOne([]);
  const view=await service.view(scope,'chat-a');assert.equal(called,false);assert.equal(view.state,'failed');assert.match(view.attempts[0].error,/escopo/i);
});
test('mídia sem texto é declarada como limitação, sem processamento extra', async()=>{
  const store=new MemoryStore(); store.messages.push({id:'media',role:'contact',text:'',at:'2026-11-01T11:00:00Z',mediaMissing:true});
  const service=new ReciprocityService(store,provider);
  await service.request(scope,'chat-a'); await service.processOne([scope]);
  const a=(await service.view(scope,'chat-a')).latestCompleted;
  assert.equal(a.coverage.missingMediaCount,1); assert.match(a.result.limitations.join(' '),/mídias sem transcrição/);
});
test('evidência abre contexto do snapshot somente do resultado autorizado', async()=>{
  const service=new ReciprocityService(new MemoryStore(),provider);
  await service.request(scope,'chat-a'); await service.processOne([scope]);
  const context=await service.evidence(scope,'chat-a','1','m1');
  assert.equal(context.messages[0].text,'E você, gosta de praia?');
  await assert.rejects(service.evidence({scopeId:'b'},'chat-a','1','m1'),{status:404});
  await assert.rejects(service.evidence(scope,'chat-a','1','other'),{status:404});
});

test('reavaliação explícita sem novas mensagens preserva as duas avaliações e deduplica somente chamadas concorrentes', async()=>{
  const store=new MemoryStore();
  const service=new ReciprocityService(store,provider);
  const first=await service.request(scope,'chat-a','manual');
  await service.processOne([scope]);
  const repeated=await Promise.all([
    service.request(scope,'chat-a','reevaluation'),
    service.request(scope,'chat-a','reevaluation'),
  ]);
  assert.notEqual(repeated[0].attempt.id,first.attempt.id);
  assert.equal(repeated[0].attempt.id,repeated[1].attempt.id);
  const processingView=await service.view(scope,'chat-a');
  assert.equal(processingView.latestCompleted.id,first.attempt.id);
  await service.processOne([scope]);
  const completedView=await service.view(scope,'chat-a');
  assert.equal(completedView.latestCompleted.id,repeated[0].attempt.id);
  assert.equal(completedView.attempts.filter(a=>a.state==='completed').length,2);
  assert.deepEqual(completedView.attempts[0].configuration,completedView.attempts[1].configuration);
  assert.equal(completedView.attempts[0].coverage.lastMessageId,completedView.attempts[1].coverage.lastMessageId);
  assert.equal((await service.evidence(scope,'chat-a',first.attempt.id,'m1')).messages[0].text,'E você, gosta de praia?');
});
