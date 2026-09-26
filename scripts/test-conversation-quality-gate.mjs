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
  assert(contract.directQuestions.length === 1 && contract.maxBalloons === 2, 'Saudação mantém a pergunta direta e limite de dois balões');
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
assert(!gate('Oi', ['Oii'], { newQuestionBudget: 0, responseShape: 'react_only', maxBalloons: 1 }).result.passed, 'Cumprimento simples sem retorno de bem-estar é bloqueado');

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
  const personaEmptyFacts = gate('Vc faz estágio de quê?', ['Moro em São João'], {
    directQuestions: [{ id: 'q1', text: 'Vc faz estágio de quê?', mustAnswer: true, answerKind: 'persona_fact', answerIntent: 'Informar estágio', requiredFacts: [] }],
    newQuestionBudget: 0,
  });
  assert(!personaEmptyFacts.result.passed, 'persona_fact sem requiredFacts não aceita frase arbitrária');
  assert(personaEmptyFacts.result.issues.some((issue) => issue.code === 'DIRECT_QUESTION_UNANSWERED'), 'persona_fact sem fatos comprovados gera DIRECT_QUESTION_UNANSWERED');

  const personaWithFacts = gate('Vc faz estágio de quê?', ['Faço estágio de enfermagem'], {
    directQuestions: [{ id: 'q1', text: 'Vc faz estágio de quê?', mustAnswer: true, answerKind: 'persona_fact', answerIntent: 'Informar estágio', requiredFacts: ['enfermagem'] }],
    newQuestionBudget: 0,
  });
  assert(personaWithFacts.result.directQuestionsAnswered === 1 && personaWithFacts.result.passed, 'persona_fact exige e aceita o fato obrigatório');
}

// Backend tem autoridade sobre inferência de alta confiança (Brain não pode rebaixar para freeform)
{
  const testKindOverride = (inbound, brainKind, expectedKind) => {
    const res = gate(inbound, ['Tô bem'], {
      directQuestions: [{ id: 'q1', text: 'e vc?', mustAnswer: true, answerKind: brainKind, answerIntent: 'Teste', requiredFacts: [] }]
    });
    return res.contract.directQuestions[0]?.answerKind;
  };
  assert(testKindOverride('Estou indo trabalhar e você?', 'freeform', 'current_activity') === 'current_activity', 'Backend impõe current_activity');
  assert(testKindOverride('tenho 27 anos, e vc?', 'freeform', 'age') === 'age', 'Backend impõe age');
  assert(testKindOverride('moro em Barbacena, e vc?', 'freeform', 'location') === 'location', 'Backend impõe location');
  assert(testKindOverride('tô bem, e vc?', 'freeform', 'wellbeing') === 'wellbeing', 'Backend impõe wellbeing');
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

console.log('\n🧪 Caso real quail: retribuição de bem-estar com pontuação isolada');
{
  const quailContract = quality.buildTurnContract(['Bem e vc ?', '?']);
  assert(quailContract.directQuestions.length === 1, 'Interrogação avulsa "?" não gera pergunta direta obrigatória');
  assert(quailContract.directQuestions[0]?.text === 'Bem e vc ?', 'Pergunta direta identificada corretamente como "Bem e vc ?"');
  assert(quailContract.directQuestions[0]?.answerKind === 'wellbeing', 'Retribuição "Bem e vc ?" classificada como wellbeing');
  assert(quality.isGreetingOrWellbeing('Bem e vc ?'), 'isGreetingOrWellbeing reconhece "Bem e vc ?"');
  assert(quality.isGreetingOrWellbeing('tudo e vc?'), 'isGreetingOrWellbeing reconhece "tudo e vc?"');
  assert(quality.isGreetingOrWellbeing('otimo e vc?'), 'isGreetingOrWellbeing reconhece "otimo e vc?"');
  assert(quality.isGreetingOrWellbeing('tranquilo e vc?'), 'isGreetingOrWellbeing reconhece "tranquilo e vc?"');

  const fallback = quality.safeHighConfidenceFallback(['Bem e vc ?', '?'], quailContract);
  assert(Array.isArray(fallback) && fallback.length === 1, 'safeHighConfidenceFallback gera fallback para "Bem e vc ?"');
  assert(fallback[0].startsWith('Oii, tô bem sim, e vc?') || fallback[0].startsWith('Tô bem sim, e vc?') || fallback[0].startsWith('Tô bem simm, e vc como tá?'), 'Fallback responde com formato canônico de bem-estar');

  const gateResult = quality.runConversationQualityGate({
    inboundMessages: ['Bem e vc ?', '?'],
    candidateBalloons: fallback,
    turnContract: quailContract,
  });
  assert(gateResult.passed, 'Fallback para o caso quail é 100% aprovado pelo Quality Gate');

  const zeroBudgetContract = quality.buildTurnContract(['Bem e vc ?', '?'], { newQuestionBudget: 0, responseShape: 'answer_only' });
  const zeroFallback = quality.safeHighConfidenceFallback(['Bem e vc ?', '?'], zeroBudgetContract);
  assert(zeroBudgetContract.newQuestionBudget === 1, 'Pergunta direta de bem-estar mantém orçamento mínimo para reciprocidade');
  assert(zeroFallback[0] === 'Tô bem simm, e vc como tá?', 'Fallback de bem-estar mantém reciprocidade obrigatória');
  const zeroResult = quality.runConversationQualityGate({
    inboundMessages: ['Bem e vc ?', '?'],
    candidateBalloons: zeroFallback,
    turnContract: zeroBudgetContract,
  });
  assert(zeroResult.passed, 'Fallback sem pergunta passa em contrato de budget zero');
}

const orchestratorSource = fs.readFileSync('supabase/functions/api/brain_orchestrator.ts', 'utf8');
const compactPromptSource = fs.readFileSync('supabase/functions/api/LarissaChatStyle.ts', 'utf8');
assert(orchestratorSource.indexOf('runStyleLint(candidateBalloons') < orchestratorSource.indexOf('runConversationQualityGate({', orchestratorSource.indexOf('runStyleLint(candidateBalloons')), 'Caminho real executa Style Lint antes do Quality Gate');
assert(orchestratorSource.includes('conversation_quality_retry=${qualityRetried}') && orchestratorSource.includes('conversation_quality_observe_only=true'), 'Quality Gate não regenera respostas e registra o resultado de forma observável');
assert(!/kieKey\s*=\s*["'][a-f0-9]{24,}["']/i.test(orchestratorSource), 'Não existe secret Kie literal');
assert(/brain_audio_rejected/.test(orchestratorSource) && /enforceAuthorizedAudioDecision/.test(orchestratorSource), 'Caminho real bloqueia troca de selectedAudioId');
assert(!/FERRAMENTAS SOB DEMANDA/.test(compactPromptSource.match(/LARISSA_COMPACT_BRAIN_PROMPT = `([\s\S]*?)`;/)?.[1] || ''), 'Prompt compacto ativo não instrui Brain a usar tools');
assert(!/\b23 anos\b|São João del-Rei|Enfermagem/.test(compactPromptSource.match(/LARISSA_COMPACT_BRAIN_PROMPT = `([\s\S]*?)`;/)?.[1] || ''), 'Prompt compacto ativo não contém fatos mutáveis hardcoded');

console.log(`\n✅ Conversation Quality Gate: ${passed}/${total} verificações aprovadas`);
