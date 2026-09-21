#!/usr/bin/env node
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

let total = 0;
let passed = 0;
function assert(condition, message) {
  total++;
  if (!condition) throw new Error(`FALHA: ${message}`);
  passed++;
  console.log(`  ✅ ${message}`);
}

function loadQualityModule() {
  const code = fs.readFileSync('supabase/functions/api/ConversationQualityGate.ts', 'utf8');
  const transpiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(transpiled, { module: mod, exports: mod.exports, Set, String, Array, Math, Number, RegExp });
  return mod.exports;
}

const quality = loadQualityModule();
const gate = (inbound, candidate, requested = null) => {
  const contract = quality.buildTurnContract([inbound], requested);
  return { contract, result: quality.runConversationQualityGate({ inboundMessages: [inbound], candidateBalloons: candidate, turnContract: contract }) };
};

console.log('🧪 Conversation Quality Gate — comportamento conversacional\n');

{
  const { result } = gate('Oii, tudo bem?', ['Oi, tudo bem? 😊', 'Como tá seu dia?']);
  const codes = result.issues.map((issue) => issue.code);
  assert(!result.passed, 'Caso real ruim é bloqueado');
  assert(codes.includes('DIRECT_QUESTION_UNANSWERED'), 'Caso real detecta pergunta direta não respondida');
  assert(codes.includes('PARROT_RESPONSE'), 'Caso real detecta resposta-papagaio');
  assert(codes.includes('QUESTION_BUDGET_EXCEEDED') || codes.includes('UNRELATED_FOLLOWUP'), 'Caso real detecta follow-up excessivo ou não relacionado');
}

{
  const { contract, result } = gate('Oii, tudo bem?', ['Oii, tô bem sim, e vc?']);
  assert(result.passed, 'Resposta direta natural passa');
  assert(contract.preferNoEmoji === true && contract.maxBalloons === 1, 'Saudação prefere zero emoji e um balão');
}

{
  const requested = {
    directQuestions: [{ id: 'q1', text: 'Vc faz estágio de quê?', mustAnswer: true, answerIntent: 'Informar área do estágio', requiredFacts: ['Enfermagem'] }],
    mustAnswerFirst: true, newQuestionBudget: 1, responseShape: 'answer_and_reciprocate', maxBalloons: 1, preferNoEmoji: true,
  };
  assert(!gate('Vc faz estágio de quê?', ['E vc trabalha com oq?'], requested).result.passed, 'Outra pergunta sem resposta falha');
  assert(gate('Vc faz estágio de quê?', ['Faço estágio de enfermagem, e vc trabalha com oq?'], requested).result.passed, 'Fato obrigatório usado diretamente passa');
}

assert(!gate('Eu trabalho com programação', ['Vc trabalha com programação?']).result.passed, 'Eco de declaração como pergunta é bloqueado');
assert(gate('Eu trabalho com programação', ['Credo eu ia quebrar a cabeça demais nisso kkk, vc gosta do que faz?'], { newQuestionBudget: 1, responseShape: 'react_and_question', maxBalloons: 1 }).result.passed, 'Reação com conteúdo novo passa');
assert(gate('Tô cansado hoje', ['Nossa então hoje é chegar em casa e apagar mesmo'], { newQuestionBudget: 0, responseShape: 'react_only', maxBalloons: 1 }).result.passed, 'Reação sem pergunta passa');
assert(!gate('Tô cansado hoje', ['Nossa que puxado, vc tem filhos?'], { newQuestionBudget: 0, responseShape: 'react_only', avoidTopics: ['filhos'], maxBalloons: 1 }).result.passed, 'Checkpoint adiado e pergunta fora do budget falham');
assert(gate('Oi', ['Oii'], { newQuestionBudget: 0, responseShape: 'react_only', maxBalloons: 1 }).result.passed, 'Cumprimento simples não exige segundo balão');

console.log('\n🧪 Tipos semânticos de resposta direta');
{
  const activity = gate('Estou indo trabalhar e você?', ['Que correria, vc trabalha com oq?']);
  assert(activity.contract.directQuestions[0]?.answerKind === 'current_activity', 'Elipse “e você?” herda current_activity da oração anterior');
  assert(activity.result.directQuestionsAnswered === 0, 'Frase sem atividade da Larissa não conta como resposta');
  assert(activity.result.issues.some((issue) => issue.code === 'DIRECT_QUESTION_UNANSWERED'), 'Atividade ausente gera DIRECT_QUESTION_UNANSWERED');
}
{
  const activity = gate('Estou indo trabalhar e você?', ['Tô indo pro estágio também']);
  assert(activity.contract.directQuestions[0]?.answerKind === 'current_activity', 'Contrato mantém current_activity na resposta válida');
  assert(activity.result.directQuestionsAnswered === 1 && activity.result.passed, 'Primeira pessoa com atividade real responde a pergunta');
}
assert(gate('eu moro em Barbacena, e vc?', ['Moro em São João'], { directQuestions: [] }).contract.directQuestions[0]?.answerKind === 'location', 'Elipse herda location');
assert(gate('tenho 27 anos, e vc?', ['Tenho 23'], { directQuestions: [] }).contract.directQuestions[0]?.answerKind === 'age', 'Elipse herda age');
assert(gate('gosto de praia, e vc?', ['Eu amo praia'], { directQuestions: [] }).contract.directQuestions[0]?.answerKind === 'preference', 'Elipse herda preference');
assert(gate('tô bem, e vc?', ['Tô bem também'], { directQuestions: [] }).contract.directQuestions[0]?.answerKind === 'wellbeing', 'Elipse herda wellbeing');
{
  const persona = gate('Vc faz estágio de quê?', ['Faço estágio de enfermagem'], {
    directQuestions: [{ id: 'q1', text: 'Vc faz estágio de quê?', mustAnswer: true, answerKind: 'persona_fact', answerIntent: 'Informar estágio', requiredFacts: ['enfermagem'] }],
    newQuestionBudget: 0,
  });
  assert(persona.result.directQuestionsAnswered === 1 && persona.result.passed, 'persona_fact exige e aceita o fato obrigatório');
}

console.log('\n🧪 Mini sequência semântica');
assert(gate('Eu tô bem também', ['Aí sim kkk']).result.passed, 'Não pergunta novamente se ele está bem');
assert(gate('Estou indo trabalhar e vc?', ['Tô resolvendo umas coisas aqui, cedo assim dá até preguiça'], {
  directQuestions: [{ id: 'q1', text: 'e vc?', mustAnswer: true, answerIntent: 'Dizer o que está fazendo', requiredFacts: ['resolvendo'] }],
  mustAnswerFirst: true, newQuestionBudget: 0, responseShape: 'answer_only', maxBalloons: 1,
}).result.passed, 'Responde primeiro o que está fazendo');
assert(gate('Trabalho com programação, vc faz estágio de quê?', ['Programação deve quebrar a cabeça demais, faço estágio de enfermagem, vc gosta do que faz?'], {
  directQuestions: [{ id: 'q1', text: 'vc faz estágio de quê?', mustAnswer: true, answerIntent: 'Informar estágio', requiredFacts: ['enfermagem'] }],
  mustAnswerFirst: true, newQuestionBudget: 1, responseShape: 'answer_and_reciprocate', maxBalloons: 1,
}).result.passed, 'Reage ao trabalho, responde o estágio e respeita uma pergunta');

const orchestratorSource = fs.readFileSync('supabase/functions/api/experimental_orchestrator.ts', 'utf8');
const compactPromptSource = fs.readFileSync('supabase/functions/api/LarissaChatStyle.ts', 'utf8');
assert(orchestratorSource.indexOf('runStyleLint(candidateBalloons') < orchestratorSource.indexOf('runConversationQualityGate({', orchestratorSource.indexOf('runStyleLint(candidateBalloons')), 'Caminho real executa Style Lint antes do Quality Gate');
assert((orchestratorSource.match(/QUALITY RETRY ÚNICO/g) || []).length === 1, 'Quality retry está limitado a uma implementação');
assert(!/kieKey\s*=\s*["'][a-f0-9]{24,}["']/i.test(orchestratorSource), 'Não existe secret Kie literal');
assert(/executor_audio_rejected/.test(orchestratorSource) && /enforceAuthorizedAudioDecision/.test(orchestratorSource), 'Caminho real bloqueia troca de selectedAudioId');
assert(!/FERRAMENTAS SOB DEMANDA/.test(compactPromptSource.match(/LARISSA_COMPACT_SUBAGENT_PROMPT = `([\s\S]*?)`;/)?.[1] || ''), 'Prompt compacto ativo não instrui executor a usar tools');
assert(!/\b23 anos\b|São João del-Rei|Enfermagem/.test(compactPromptSource.match(/LARISSA_COMPACT_SUBAGENT_PROMPT = `([\s\S]*?)`;/)?.[1] || ''), 'Prompt compacto ativo não contém fatos mutáveis hardcoded');

console.log(`\n✅ Conversation Quality Gate: ${passed}/${total} verificações aprovadas`);
