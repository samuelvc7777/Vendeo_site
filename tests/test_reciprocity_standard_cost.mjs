import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenAiReciprocityProvider} from '../supabase/functions/api/reciprocity_openai.ts';
const configuration={model:'gpt-6-luna',reasoning:'low'};
test('análise Standard já estima custo sem configuração adicional de tarifas',async()=>{
  const result={participation:'evidencia_insuficiente',curiosity:'evidencia_insuficiente',summary:'Sem contexto.',reasons:[],evolution:'indeterminada',limitations:[],evidence:[]};
  let requestBody;
  const provider=new OpenAiReciprocityProvider({apiKey:'fake',validatedModels:['gpt-6-luna'],fetch:async(_,init)=>{
    requestBody=JSON.parse(init.body);
    return new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}],usage:{input_tokens:1000,output_tokens:100,input_tokens_details:{cached_tokens:200}}}));
  }});
  const output=await provider.evaluate([],configuration);
  assert.equal(requestBody.service_tier,'default');
  assert.equal(output.estimatedCostUsd,0.000132);
});

test('custo Standard aplica acréscimo de contexto longo aos tokens informados pela API',async()=>{
  const result={participation:'evidencia_insuficiente',curiosity:'evidencia_insuficiente',summary:'Sem contexto.',reasons:[],evolution:'indeterminada',limitations:[],evidence:[]};
  const provider=new OpenAiReciprocityProvider({apiKey:'fake',validatedModels:['gpt-6-luna'],fetch:async()=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}],usage:{input_tokens:300000,output_tokens:1000,input_tokens_details:{cached_tokens:20000}}}))});
  const output=await provider.evaluate([],configuration);
  assert.equal(output.estimatedCostUsd,0.05715);
});
