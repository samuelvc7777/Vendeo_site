// Avaliação opt-in: usa a API OpenAI, sem acessar chats ou enviar WhatsApp.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceRoot=process.env.ROUTINE_EVAL_SOURCE_ROOT||root;
const {LARISSA_CANONICAL_PROMPT,LARISSA_CANONICAL_PROMPT_VERSION}=await import(pathToFileURL(path.join(sourceRoot,'supabase/functions/api/larissa_canonical_prompt.generated.ts')).href);
const sdk=fs.readFileSync(path.join(sourceRoot,'supabase/functions/api/openai_sdk_brain.ts'),'utf8');
const start=sdk.indexOf('function buildOperationalTurnState(');
const end=sdk.indexOf('\nfunction ',start+1);
if(start<0||end<0)throw Error('Bloco operacional não encontrado');
const context=vm.createContext({});
vm.runInContext(ts.transpileModule(sdk.slice(start,end),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,context);
const env=fs.existsSync(path.join(root,'.env.local'))?parseEnv(fs.readFileSync(path.join(root,'.env.local'),'utf8')):{};
let key=process.env.OPENAI_API_KEY||env.OPENAI_API_KEY;
if(process.argv.includes('--production-key')){
 const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL||env.NEXT_PUBLIC_SUPABASE_URL;
 if(!serviceKey||!url)throw Error('Credenciais de servidor Supabase ausentes');
 const r=await fetch(url+'/rest/v1/instagram_config?id=eq.openai_api_key&select=app_secret',{headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey},signal:AbortSignal.timeout(15000)});
 if(!r.ok)throw Error('Não foi possível obter a chave do servidor: HTTP '+r.status);
 key=(await r.json())[0]?.app_secret?.trim();
}
if(!key)throw Error('OPENAI_API_KEY ausente');
const cases=[
 {id:'morning',time:'08:28',message:'oq vc tá fazendo agora?',expected:/loja|roupa|pedido|envio|estud/i,forbidden:/estágio|estagio|hospital|faculdade|aula/i},
 {id:'internship',time:'13:30',message:'tá fazendo oq agora?',expected:/estágio|estagio|hospital/i,forbidden:/t[oô].{0,15}(faculdade|aula)/i},
 {id:'college',time:'20:15',message:'o que tá fazendo agora?',expected:/aula|faculdade|escola/i,forbidden:/t[oô].{0,15}(estágio|estagio|hospital)/i},
 {id:'incompatible_audio',time:'08:28',message:'oq tá fazendo agora?',expected:/loja|roupa|pedido|envio|estud/i,audio:true,forbidden:/estágio|estagio|hospital/i},
 {id:'unknown_specific_event',time:'08:28',message:'que horas você chegou em casa ontem?',manual:true},
 {id:'raffle_fourth_turn_morning',time:'10:24',message:'vc já tá planejando os abraços kkk',raffleTurn:4},
 {id:'raffle_third_turn_no_reask',time:'10:55',message:'Eu tbm gosto de ajudar as pessoas. Eu sou simpático com as pessoas tbm',raffleTurn:3},
 {id:'raffle_overdue_evening',time:'20:15',message:'qual passeio vc queria fazer comigo?',raffleTurn:7},
];
const only=process.argv.find(x=>x.startsWith('--case='))?.slice(7);
const results=[];
for(const c of cases.filter(c=>!only||c.id===only)){
 const params={currentScheduleId:'eval',currentScheduleName:'Conexão',currentScheduleExecutionMode:'connection_window',currentStageId:'stage_1_conexao',currentStageRequired:false,isFinalStage:false,connectionIntent:'Conversar naturalmente',temporalContext:`DATA/HORA ATUAL EM SÃO PAULO: quinta-feira, 08/10/2026, ${c.time}. Fuso America/Sao_Paulo.`,currentInboundMessages:[{id:'synthetic',text:c.message}],arsenalCandidates:[],audioPrefetchComplete:true,
   prefetchedAudioCandidateGroups:c.audio?[{objectiveId:'eval_audio',candidates:[{audioId:'synthetic-internship',title:'No estágio',whenToUse:'Rotina',transcript:'Tô aqui no estágio agora e tenho um boleto pra pagar hoje.'}]}]:[]};
 if(c.raffleTurn){
   Object.assign(params,{currentScheduleExecutionMode:'goal_driven',currentStageId:'stage_rifa',currentStageRequired:true,isFinalStage:true,currentObjectiveId:'raffle_audio',currentObjectiveLabel:'Oferecer a rifa',currentObjectiveRequired:true,currentObjectiveKind:'action',currentObjectiveActionType:'send_audio',currentObjectiveCompletionPolicy:'delivery_confirmed',objectiveAudioDeadline:{objectiveId:'raffle_audio',maxTurns:4,currentTurn:c.raffleTurn,allowTemporalMismatch:true},prefetchedAudioCandidateGroups:[{objectiveId:'raffle_audio',candidates:[{audioId:'synthetic-raffle',title:'Oferecendo a rifa',whenToUse:'Oferecer a rifa',transcript:'Fiz uma rifinha pra me ajudar com a mensalidade da faculdade. Hoje veio o boleto e faltam dez bilhetinhos. Estou aqui no estágio na correria, você poderia comprar alguns bilhetinhos pra me ajudar?'}]}]});
 }
 const input=context.buildOperationalTurnState(params)+'\nPRETENDENTE: '+c.message+'\nResponda com o plano JSON completo do Brain.';
 const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{authorization:'Bearer '+key,'content-type':'application/json'},body:JSON.stringify({model:'gpt-6.1-sol',service_tier:'default',store:false,instructions:LARISSA_CANONICAL_PROMPT,input,reasoning:{effort:'medium'},text:{format:{type:'json_object'},verbosity:'low'},max_output_tokens:3000}),signal:AbortSignal.timeout(60000)});
 const body=await response.json();
 if(!response.ok)throw Error('Avaliação OpenAI: HTTP '+response.status+' '+(body.error?.code||body.error?.type||'unknown'));
 const raw=(body.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('');
 const plan=JSON.parse(raw);
 const actions=plan.outboundActions||[];
 const text=actions.filter(x=>x.type==='text').map(x=>x.text).join(' ');
 const passed=c.raffleTurn?plan.action==='reply'&&actions.some(x=>x.type==='audio'&&x.audioId==='synthetic-raffle'):c.manual?plan.action==='manual_resolution'&&actions.length===0:plan.action==='reply'&&c.expected.test(text)&&(!c.forbidden||!c.forbidden.test(text))&&(!c.audio||actions.every(x=>x.type!=='audio'));
 results.push({id:c.id,passed,action:plan.action,text,usage:body.usage});
 console.log(JSON.stringify({id:c.id,passed,action:plan.action,text}));
}
const output=process.env.ROUTINE_EVAL_OUTPUT||path.join(root,'.firebase/automation-audit/routine-eval.json');
fs.writeFileSync(output,JSON.stringify({promptVersion:LARISSA_CANONICAL_PROMPT_VERSION,checkedAt:new Date().toISOString(),results},null,2));
if(results.some(x=>!x.passed))process.exitCode=1;
