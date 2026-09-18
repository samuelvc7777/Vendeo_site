const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = fs.readFileSync('supabase/functions/api/index.ts', 'utf8');
const normalizedSource = source.replace(/\r\n/g, '\n');
const section = normalizedSource.slice(normalizedSource.indexOf('function normalizeOperatorText'), normalizedSource.indexOf('/**\n * Cérebro de Persona'));
const context = vm.createContext({ getGroqApiKey: async () => null, console });
vm.runInContext(ts.transpile(section), context);
(async () => {
  const items = [
    { id: 'greeting', title: 'Saudação', type: 'text', content: 'Estou ótima', isCompleted: false },
    { id: 'city', title: 'Cidade', type: 'text', content: 'Você é de onde ??', isCompleted: false },
  ];
  const result = await context.orchestrateConversationStep({}, items, [{ sender: 'them', text: 'Tudo bem com você?' }], 'Teste', 'Inicio');
  assert.equal(result.action, 'call_persona');
  assert.deepEqual(Array.from(result.targetChecklistIds), ['greeting', 'city']);
  assert.match(result.directiveForPersona, /Estou ótima/);
  assert.match(result.directiveForPersona, /Você é de onde \?\?/);
  assert.match(result.directiveForPersona, /Não fale de estágio/);
  const day = await context.orchestrateConversationStep({}, items, [{ sender: 'them', text: 'Como foi seu dia?' }], 'Teste', 'Inicio');
  assert.equal(day.action, 'call_persona');
  assert.notDeepEqual(Array.from(day.targetChecklistIds), ['greeting', 'city']);

  const afterCityItems = [
    { id: 'city', title: 'Cidade', type: 'text', content: 'Você é de onde ??', isCompleted: true },
    { id: 'my_city', title: 'Minha cidade', type: 'text', content: 'Sou de São João del Rei, MG, conhece ?', isCompleted: false },
    { id: 'about_him_1', title: 'Perguntando sobre ele 01', type: 'text', content: 'Me fala mais sobre você, pra gente se conhecer melhor...', isCompleted: false },
  ];
  const afterCity = await context.orchestrateConversationStep(
    {},
    afterCityItems,
    [
      { sender: 'me', text: 'Você é de onde ??' },
      { sender: 'them', text: 'Eu moro no bairro matozinhos e vc ?' },
    ],
    'Teste',
    'Etapa 01'
  );
  assert.equal(afterCity.action, 'call_persona');
  assert.deepEqual(Array.from(afterCity.targetChecklistIds), ['my_city']);
  assert.match(afterCity.directiveForPersona, /Sou de São João del Rei, MG, conhece \?/);
  assert.match(afterCity.directiveForPersona, /Não invente perguntas laterais/);
  assert.match(afterCity.directiveForPersona, /bairro, lugar favorito/);

  console.log('PASS: saudação chama Persona com trilho da cidade; após cidade segue o próximo item aprovado sem pergunta lateral.');
})().catch(error => { console.error(error); process.exitCode = 1; });
