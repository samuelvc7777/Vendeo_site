import test from 'node:test';
import assert from 'node:assert/strict';
import {authenticateReciprocityScope} from '../supabase/functions/api/reciprocity_auth.ts';
import {handleReciprocityRequest} from '../supabase/functions/api/reciprocity_routes.ts';
const token='test-secret-123';
const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(v=>v.toString(16).padStart(2,'0')).join('');
const config=JSON.stringify([{scopeId:'scope-a',tokenHash:hash,conversationIds:['chat-a']}]);
test('anon key e origem não autenticam análise; chave específica resolve escopo sem aceitar escopo do cliente',async()=>{
  const req=new Request('https://api.test/operator/reciprocity',{headers:{apikey:token,origin:'https://vendeo-e755e.web.app'}});
  await assert.rejects(authenticateReciprocityScope(req,config),{status:401});
  const auth=new Request(req,{headers:{'x-reciprocity-key':token,'x-scope-id':'attacker'}});
  assert.equal((await authenticateReciprocityScope(auth,config)).scopeId,'scope-a');
  await assert.rejects(authenticateReciprocityScope(auth,'[]'),{status:401});
});
test('rota consulta apenas conversa autorizada e recusa execução sem autenticação',async()=>{
  const fakeService={async view(scope,id){assert.equal(scope.scopeId,'scope-a'); return {state:'none',latestCompleted:null,attempts:[],eligible:id==='chat-a'};}};
  const response=await handleReciprocityRequest({request:new Request('https://api.test/operator/reciprocity?conversationId=chat-a',{headers:{'x-reciprocity-key':token}}),path:'/operator/reciprocity',scopesJson:config,service:fakeService,corsHeaders:{}});
  assert.equal(response.status,200); assert.equal((await response.json()).eligible,true);
  const denied=await handleReciprocityRequest({request:new Request('https://api.test/operator/reciprocity',{method:'POST',body:'{"conversationId":"chat-a"}'}),path:'/operator/reciprocity',scopesJson:config,service:fakeService,corsHeaders:{}});
  assert.equal(denied.status,401);
});
