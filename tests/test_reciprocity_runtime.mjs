import test from 'node:test';
import assert from 'node:assert/strict';
import { handleReciprocityApi } from '../supabase/functions/api/reciprocity_runtime.ts';

test('rota integrada de eventos não abre Realtime com chave pública ou conversa não autorizada', async () => {
  let subscribed = false;
  const response = await handleReciprocityApi({
    request: new Request('https://app.test/operator/reciprocity/events?conversationId=private', {headers:{apikey:'public-anon'}}),
    path: '/operator/reciprocity/events', scopesJson: '[]', providerOptions: {apiKey:''}, corsHeaders: {},
    supabase: { channel() { subscribed = true; throw new Error('should not subscribe'); } },
  });
  assert.equal(response.status, 401);
  assert.equal(subscribed, false);
});

test('rota integrada transmite somente mudanças do escopo e conversa autorizados', async () => {
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('operator-secret')))].map(x=>x.toString(16).padStart(2,'0')).join('');
  let emit;
  let removed = false;
  const channel = {
    on(_kind, _filter, callback) { emit = callback; return this; },
    subscribe(callback) { callback('SUBSCRIBED'); return this; },
  };
  const controller = new AbortController();
  const response = await handleReciprocityApi({
    request: new Request('https://app.test/operator/reciprocity/events?conversationId=chat', {headers:{'X-Reciprocity-Key':'operator-secret'},signal:controller.signal}),
    path:'/operator/reciprocity/events', scopesJson:JSON.stringify([{scopeId:'scope',tokenHash:hash,allConversations:true}]),
    providerOptions:{apiKey:''},corsHeaders:{},supabase:{
      from(){return {select(){return this;},eq(){return this;},async maybeSingle(){return {data:{id:'chat'}};}};},
      channel(){return channel;}, async removeChannel(){removed = true;},
    },
  });
  const reader=response.body.getReader();
  assert.match(new TextDecoder().decode((await reader.read()).value),/event: ready/);
  emit({new:{scope_id:'another',conversation_id:'chat',result:'must stay private'}});
  emit({new:{scope_id:'scope',conversation_id:'another'}});
  emit({new:{scope_id:'scope',conversation_id:'chat',result:'also stays private'}});
  assert.equal(new TextDecoder().decode((await reader.read()).value),'event: change\ndata: {}\n\n');
  controller.abort();
  assert.equal((await reader.read()).done,true);
  assert.equal(removed,true);
});
