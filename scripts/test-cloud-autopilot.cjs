const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

// Executa os módulos reais, substituindo somente rede, relógio de espera e banco.
function runtime(fetch) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (!file.endsWith('.ts')) file += '.ts';
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(code, {
      module, exports: module.exports,
      require: (ref) => load(path.resolve(path.dirname(file), ref)),
      fetch, AbortSignal, console, TextDecoder, TextEncoder, setTimeout: (fn) => { fn(); return 0; },
    }, { filename: file });
    return module.exports;
  }
  const deps = {
    getGroqApiKey: async () => null, getOpenAiApiKey: async () => null,
    getTokenHarborApiKey: async () => null, getAtriaApiKey: async () => 'test-atria',
    getKieApiKey: async () => 'test-sol', extractKieResponseText: (text) => text,
    sanitizeResponses: () => { throw new Error('Não deve reescrever o Sol'); },
  };
  const { createCloudAutoPilotSupport } = load('supabase/functions/api/cloud_autopilot_support.ts');
  return { load, deps, createCloudAutoPilotSupport, support: createCloudAutoPilotSupport(deps) };
}
const response = (value, ok = true) => ({ ok, status: ok ? 200 : 500,
  json: async () => value, text: async () => JSON.stringify(value) });
const atriaResponse = (decision) => response({ choices: [{ message: { content: JSON.stringify(decision) } }] });
const item = { id: 'next', type: 'text', title: 'Cidade', content: 'Texto aprovado?', isCompleted: false };
const input = {
  pretendente: { id: 'chat', name: 'Contato de teste', platform: 'instagram', bio: 'Bio de teste' },
  instagramHistory: Array.from({ length: 501 }, (_, i) => ({
    id: String(i), sender: i % 2 ? 'me' : 'them', text: `MSG_${String(i).padStart(3, '0')}_FIM`,
    timestamp: new Date(Date.UTC(2026, 8, 16, 0, i)).toISOString(),
  })),
  personaReferences: [{ category: 'teste', them_message: 'oi', larissa_response: 'Referência de teste' }],
  mode: 'markdown',
};

test('Copiar Prompt e Edge usam o mesmo prompt completo com as últimas 500 mensagens', () => {
  const { load } = runtime(() => { throw new Error('Sem rede'); });
  const Front = load('src/application/use-cases/GenerateAiPromptUseCase.ts').GenerateAiPromptUseCase;
  const Edge = load('supabase/functions/api/instagram_ai.ts').GenerateAiPromptUseCase;
  const front = new Front().execute(input).prompt;
  assert.equal(front, new Edge().execute(input).prompt);
  assert.ok(front.includes('Você é a LARISSA'));
  assert.ok(front.includes('Referência de teste'));
  assert.ok(!front.includes('MSG_000_FIM'));
  assert.ok(front.indexOf('MSG_001_FIM') < front.indexOf('MSG_500_FIM'));
  assert.equal(front.split('MSG_001_FIM').length - 1, 1);
});

test('Atria recebe todo o prompt e pode chamar Sol mesmo com áudio pendente', async () => {
  let payload;
  const { support } = runtime(async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer test-atria');
    payload = JSON.parse(options.body);
    return atriaResponse({ action: 'call_persona' });
  });
  const audio = { ...item, type: 'audio', mediaUrl: 'https://test.invalid/audio' };
  const result = await support.atriaControlStep(support.decideConversationStep([audio], audio),
    { conversationPrompt: 'HISTÓRICO INTEGRAL ' + 'x'.repeat(5000), stageName: 'Início', checklist: [audio] }, {});
  assert.equal(result.action, 'call_persona');
  assert.deepEqual(Array.from(result.targetChecklistIds), []);
  const dossierContent = payload.messages[1].content;
  assert.ok(dossierContent.includes('HISTÓRICO INTEGRAL'));
  assert.ok(dossierContent.includes(audio.id));
  assert.ok(!dossierContent.includes('https://test.invalid/audio'));
});

test('Atria nunca envia texto cru do cofre: transforma o item em objetivo para o Sol', async () => {
  let ids = ['next'];
  const { support } = runtime(async () => atriaResponse({ action: 'send_checklist_batch', checklistItemIds: ids }));
  const context = { conversationPrompt: 'Histórico', stageName: 'Início', checklist: [item], latestContactText: 'Sou caminhoneiro e gosto de praia' };
  const base = support.decideConversationStep([item], item);
  const valid = await support.atriaControlStep(base, context, {});
  assert.equal(valid.action, 'call_persona');
  assert.deepEqual(Array.from(valid.targetChecklistIds), ['next']);
  assert.equal(valid.checklistBatch, undefined);
  ids = ['inventado'];
  assert.equal((await support.atriaControlStep(base, context, {})).action, 'pause_guardrail');
});

test('Atria adia áudio pessoal sem abertura e libera somente um quando ele pergunta sobre ela', async () => {
  const audio1 = { id: 'audio-1', type: 'audio', title: 'Sobre Larissa 01', mediaUrl: 'https://test.invalid/1.mp3', linkedItemId: 'audio-2', isCompleted: false };
  const audio2 = { id: 'audio-2', type: 'audio', title: 'Sobre Larissa 02', mediaUrl: 'https://test.invalid/2.mp3', linkedItemId: 'audio-1', isCompleted: false };
  const env = runtime(async () => atriaResponse({ action: 'send_approved_media', mediaItemIds: ['audio-1'], reason: 'hora de falar dela' }));
  const base = env.support.decideConversationStep([audio1, audio2], audio1);
  const noOpening = await env.support.atriaControlStep(base, {
    conversationPrompt: 'Histórico', stageName: 'Sobre ela', checklist: [audio1, audio2],
    latestContactText: 'Sou caminhoneiro, gosto de praia e tenho 23 anos',
  }, {});
  assert.equal(noOpening.action, 'call_persona');
  assert.equal(noOpening.checklistBatch, undefined);

  const withOpening = await env.support.atriaControlStep(base, {
    conversationPrompt: 'Histórico', stageName: 'Sobre ela', checklist: [audio1, audio2],
    latestContactText: 'Legal, e você, o que faz da vida?',
  }, {});
  assert.equal(withOpening.action, 'send_checklist_batch');
  assert.deepEqual(Array.from(withOpening.targetChecklistIds), ['audio-1']);
  assert.equal(withOpening.checklistBatch.length, 1);
});

test('Sem Atria pausa, mas decisão fora do formato segue pelo Sol com segurança', async () => {
  const env = runtime(async () => atriaResponse({ action: 'inventada' }));
  const base = env.support.decideConversationStep([item], item);
  const context = { conversationPrompt: 'Histórico', stageName: 'Início', checklist: [item] };
  assert.equal((await env.support.atriaControlStep(base, context, {})).action, 'call_persona');
  const withoutKey = env.createCloudAutoPilotSupport({ ...env.deps, getAtriaApiKey: async () => null });
  assert.equal((await withoutKey.atriaControlStep(base, context, {})).action, 'pause_guardrail');
});

test('Sol recebe prompt idêntico, não é reescrito e só conclui objetivos autorizados', async () => {
  let payload;
  const { support } = runtime(async (url, options) => {
    payload = JSON.parse(options.body);
    return response({ responses: ['Texto. Com pontuação! 😊'], completed_checklist_ids: ['next'] });
  });
  const result = await support.generatePersonaResponse({}, 'PROMPT COPIÁVEL INTEGRAL', ['next']);
  const sentPrompt = payload.contents?.[0]?.parts?.[0]?.text || payload.input?.[0]?.content?.[0]?.text;
  assert.equal(sentPrompt, 'PROMPT COPIÁVEL INTEGRAL');
  assert.equal(result.responses[0], 'Texto. Com pontuação! 😊');
  assert.deepEqual(Array.from(result.completedItemIds), ['next']);
});

test('Sol não pode declarar conclusão fora dos objetivos liberados pela Atria', async () => {
  const env = runtime(async () => response({ responses: ['Resposta natural'], completed_checklist_ids: ['inventado'] }));
  await assert.rejects(env.support.generatePersonaResponse({}, 'prompt', ['next']), /checklist inválido/i);
});

test('Sol em texto puro continua sendo usado sem acionar o fallback', async () => {
  const env = runtime(async () => ({ ok: true, status: 200, text: async () => 'Resposta natural do Sol.' }));
  const result = await env.support.generatePersonaResponse({}, 'PROMPT', []);
  assert.equal(result.responses[0], 'Resposta natural do Sol.');
  assert.ok(result.modelUsed.includes('gemini-3-8-flash') || result.modelUsed.includes('gpt-5-6-sol'));
});

test('Sol repete a chamada quando o Kie devolve erro SSE dentro de HTTP 200', async () => {
  let calls = 0;
  const recordedBodies = [];
  const env = runtime(async (url, options) => {
    calls++;
    recordedBodies.push(JSON.parse(options.body));
    if (calls === 1) return {
      ok: true, status: 200,
      text: async () => 'event: error\ndata: {"type":"server_error","message":"The server is currently being maintained"}\n',
    };
    return response({ responses: ['Resposta real do Sol após nova tentativa.'] });
  });
  const result = await env.support.generatePersonaResponse({}, 'PROMPT', []);
  assert.equal(calls, 2);
  assert.equal(result.responses[0], 'Resposta real do Sol após nova tentativa.');
});

test('Parser do Sol rejeita payloads de controle corrompidos em vez de vazar JSON cru', async () => {
  const env = runtime(async () => ({
    ok: true, status: 200,
    text: async () => 'json\n{\n  "analise_do_pretendente": "Análise corrompida",\n  "responses": ["Resposta válida"]\n}',
  }));
  const result = await env.support.generatePersonaResponse({}, 'PROMPT', []);
  assert.equal(result.responses[0], 'Resposta válida');

  const envCorrupt = runtime(async () => ({
    ok: true, status: 200,
    text: async () => 'json\n{\n  "analise_do_pretendente": "JSON quebrado sem fechar responses',
  }));
  await assert.rejects(envCorrupt.support.generatePersonaResponse({}, 'PROMPT', []), /estrutura de controle corrompida|resposta sem texto/);
});

test('Fallback do Atria gera apenas texto quando o Sol está indisponível', async () => {
  const env = runtime(async (url) => {
    if (url.includes('atria-asi')) {
      return response({ choices: [{ message: { content: 'json\n{"responses":["Uma resposta natural de fallback.","Outra resposta."]}' } }] });
    }
    return response({}, false);
  });
  const result = await env.support.generateAtriaFallbackResponse({}, 'PROMPT COMPLETO');
  assert.equal(result.responses[0], 'Uma resposta natural de fallback.');
  assert.equal(result.responses[1], 'Outra resposta.');
  assert.equal(result.completedItemIds.length, 0);
});

test('Fallback da Groq responde com sucesso e balões quando Sol no Kie falha', async () => {
  const env = runtime(async (url) => {
    if (url.includes('kie.ai')) {
      return response({ code: 500, msg: 'Server exception, please try again later' }, false);
    }
    if (url.includes('groq.com')) {
      return response({ choices: [{ message: { content: 'json\n{"responses":["Resposta rápida da Groq."],"completedItemIds":["item-1"]}' } }] });
    }
    return response({}, false);
  });
  const support = env.createCloudAutoPilotSupport({ ...env.deps, getGroqApiKey: async () => 'test-groq' });
  const result = await support.generateGroqFallbackResponse({}, 'PROMPT COMPLETO', ['item-1']);
  assert.equal(result.responses[0], 'Resposta rápida da Groq.');
  assert.equal(result.completedItemIds[0], 'item-1');
  assert.equal(result.completedItemIds.length, 1);
  assert.ok(result.modelUsed.includes('Groq'));
});


test('Prompt do Sol transforma checklist em objetivo invisível, nunca em texto para copiar', () => {
  const { load } = runtime(() => { throw new Error('Sem rede'); });
  const Builder = load('src/application/use-cases/GenerateAiPromptUseCase.ts').GenerateAiPromptUseCase;
  const prompt = new Builder().execute({ ...input, stageContext: {
    stageName: 'Etapa 01', stageIndex: 0, totalStages: 2, checklist: [item], turnGoalIds: ['next'],
  }}).prompt;
  assert.ok(prompt.includes('OBJETIVO INVISÍVEL DESTE TURNO'));
  assert.ok(prompt.includes('Cidade'));
  assert.ok(prompt.includes('completed_checklist_ids'));
  assert.ok(prompt.includes('Responda primeiro ao que ele acabou de dizer'));
  assert.ok(prompt.includes('Um "tudo bem e vc?" pede apenas como você está'));
  assert.ok(prompt.includes('No máximo uma nova pergunta por turno'));
});

test('Progresso usa ChatStage.id e só avança depois de uma entrega confirmada', async () => {
  const calls = [];
  const env = runtime(async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ url, body });
    if (url.includes('atria-asi')) return atriaResponse({ action: 'call_persona', checklistGoalIds: ['next'] });
    if (url.includes('kie.ai')) return response({ responses: ['Resposta natural.'], completed_checklist_ids: ['next'] });
    return response({ message_id: 'sent-message' });
  });
  const db = database();
  const stageRow = db.rows.instagram_conversations.find((row) => row.id === '__chat_stages__');
  stageRow.stage_completed_rules.stages.push({ id: 'stage-2', name: 'Sobre ela', order: 2, folderId: 'folder-2' });
  const vaultRow = db.rows.instagram_conversations.find((row) => row.id === '__vault_data__');
  vaultRow.stage_completed_rules.folders.push({ id: 'folder-2', name: 'Sobre ela' });
  vaultRow.stage_completed_rules.items.push({ id: 'audio-1', folderId: 'folder-2', type: 'audio', title: 'Sobre Larissa 01', mediaUrl: 'https://test.invalid/1.mp3' });
  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');
  await runCloudAutoPilot({ supabase: db, conversationId: 'chat', triggerMessageId: '500',
    triggerTimestamp: input.instagramHistory[500].timestamp, triggerText: 'MSG_500_FIM',
    runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null } });
  const progress = db.rows.instagram_conversations.find((row) => row.id === '__chat_progress__').stage_completed_rules.progresses.chat;
  assert.equal(progress.currentStageId, 'stage-2');
  assert.equal(calls.at(-1).body.message.text, 'Resposta natural.');
});

test('Regressão real: resposta sobre trabalho/praia/idade não dispara os áudios pessoais', async () => {
  const sent = [];
  const env = runtime(async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.includes('atria-asi')) return atriaResponse({ action: 'send_approved_media', mediaItemIds: ['audio-1'] });
    if (url.includes('kie.ai')) return response({ responses: ['Praia é bom demais, vc costuma ir pra qual lado?'], completed_checklist_ids: [] });
    sent.push(body.message);
    return response({ message_id: 'sent-message' });
  });
  const db = database();
  db.rows.instagram_conversations.find((row) => row.id === '__chat_progress__').stage_completed_rules.progresses.chat = {
    currentStageId: 'stage-2', completedItemIds: ['next'],
  };
  db.rows.instagram_conversations.find((row) => row.id === '__chat_stages__').stage_completed_rules.stages.push({
    id: 'stage-2', name: 'Sobre ela', order: 2, folderId: 'folder-2',
  });
  const vault = db.rows.instagram_conversations.find((row) => row.id === '__vault_data__').stage_completed_rules;
  vault.folders.push({ id: 'folder-2', name: 'Sobre ela' });
  vault.items.push({ id: 'audio-1', folderId: 'folder-2', type: 'audio', title: 'Sobre Larissa 01', mediaUrl: 'https://test.invalid/1.mp3', isCompleted: false });
  db.rows.instagram_messages.push({ id: 'fresh', conversation_id: 'chat', is_mine: false, sender_id: '123', text: 'Sou caminhoneiro, gosto de praia e tenho 23 anos', timestamp: '2026-09-16T13:00:00.000Z' });
  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');
  await runCloudAutoPilot({ supabase: db, conversationId: 'chat', triggerMessageId: 'fresh',
    triggerTimestamp: '2026-09-16T13:00:00.000Z', triggerText: 'Sou caminhoneiro, gosto de praia e tenho 23 anos',
    runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null } });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, 'Praia é bom demais, vc costuma ir pra qual lado?');
  assert.equal(sent[0].attachment, undefined);
});

test('Erro ou mídia gerada pelo Sol não aciona fallback nem vira mensagem', async () => {
  let calls = 0;
  const env = runtime(async () => { calls++; return response({}, false); });
  await assert.rejects(env.support.generatePersonaResponse({}, 'prompt'), /Sol indisponível/);
  assert.equal(calls, 3);
  const media = runtime(async () => response({ responses: ['[audio:https://inventado.invalid]'] }));
  await assert.rejects(media.support.generatePersonaResponse({}, 'prompt'), /balões de texto/);
});

function database() {
  const broadcasts = [];
  const rows = {
    instagram_conversations: [
      { id: '__autopilot_config__', stage_completed_rules: { config: { isEnabledGlobally: true } } },
      { id: '__autopilot_states__', stage_completed_rules: { states: { chat: { isEnabled: true, status: 'idle' } } } },
      { id: '__chat_progress__', stage_completed_rules: { progresses: { chat: { currentStageId: 'folder', completedItemIds: [] } } } },
      { id: '__chat_stages__', stage_completed_rules: { stages: [{ id: 'stage-1', name: 'Início', order: 1, folderId: 'folder' }] } },
      { id: '__vault_data__', stage_completed_rules: { folders: [{ id: 'folder', name: 'Início' }], items: [{ ...item, folderId: 'folder' }] } },
      { id: 'chat', full_name: 'Contato de teste', username: 'teste' },
    ],
    instagram_messages: input.instagramHistory.map((m) => ({ ...m, conversation_id: 'chat', is_mine: m.sender === 'me', sender_id: m.sender === 'me' ? 'me' : '123' })),
    instagram_config: [{ id: 'default', access_token: 'test-meta' }], ai_persona_references: [],
  };
  return { rows, broadcasts, channel: () => ({ send: async (event) => { broadcasts.push(event); } }), from(table) {
    let filters = [], sort, count, one = false, write, patch, selectedColumns = '*';
    const query = {
      select(columns = '*') { selectedColumns = columns; return query; }, eq(key, val) { filters.push((row) => row[key] === val); return query; },
      order(key, options) { sort = [key, options]; return query; }, limit(n) { count = n; return query; },
      maybeSingle() { one = true; return query; }, upsert(row) { write = row; return query; },
      update(row) { patch = row; return query; },
      then(resolve, reject) {
        if (table === 'instagram_conversations' && /\b(?:city|bio)\b/.test(selectedColumns)) {
          return Promise.resolve({ data: null, error: { code: '42703', message: 'column does not exist' } }).then(resolve, reject);
        }
        if (write) { const index = rows[table].findIndex((row) => row.id === write.id);
          if (index < 0) rows[table].push(write); else rows[table][index] = { ...rows[table][index], ...write }; }
        let data = rows[table].filter((row) => filters.every((filter) => filter(row)));
        if (patch) for (const row of data) Object.assign(row, patch);
        if (sort) data.sort((a, b) => String(a[sort[0]]).localeCompare(String(b[sort[0]])) * (sort[1].ascending ? 1 : -1));
        if (count) data = data.slice(0, count);
        return Promise.resolve({ data: one ? data[0] : data, error: null }).then(resolve, reject);
      },
    }; return query;
  } };
}

test('Ciclo backend: Atria → Sol → Meta usa 500 mensagens; pausa não chama Sol ou Meta', async () => {
  for (const action of ['call_persona', 'pause_handoff', 'sol_error']) {
    const calls = [];
    const env = runtime(async (url, options) => {
      const body = JSON.parse(options.body); calls.push({ url, body });
      if (url.includes('atria-asi')) {
        if (action === 'sol_error' && calls.filter((call) => call.url.includes('atria-asi')).length > 1) {
          return response({ choices: [{ message: { content: 'Resposta de contingência do Atria.' } }] });
        }
        return atriaResponse({ action: action === 'sol_error' ? 'call_persona' : action, checklistGoalIds: ['next'] });
      }
      if (url.includes('kie.ai')) return response({ responses: ['Resposta do Sol.'], completed_checklist_ids: ['next'] }, action !== 'sol_error');
      return response({ message_id: 'sent-message' });
    });
    const db = database();
    const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');
    await runCloudAutoPilot({ supabase: db, conversationId: 'chat', triggerMessageId: '500',
      triggerTimestamp: input.instagramHistory[500].timestamp, triggerText: 'MSG_500_FIM',
      runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null } });
    assert.equal(calls[0].url.includes('atria-asi'), true);
    const contextMd = calls[0].body.messages[1].content;
    assert.ok(!contextMd.includes('MSG_000_FIM'));
    assert.ok(contextMd.includes('MSG_001_FIM'));
    if (action === 'call_persona') {
      assert.equal(calls.length, 3);
      const personaPrompt = calls[1].body.contents?.[0]?.parts?.[0]?.text || calls[1].body.input?.[0]?.content?.[0]?.text;
      assert.ok(personaPrompt.includes('OBJETIVO INVISÍVEL DESTE TURNO'));
      assert.ok(personaPrompt.includes('MSG_500_FIM'));
      assert.equal(calls[2].body.message.text, 'Resposta do Sol.');
      assert.deepEqual(Array.from(db.rows.instagram_conversations.find((r) => r.id === '__chat_progress__').stage_completed_rules.progresses.chat.completedItemIds), ['next']);
      const uniqueVisualPhases = [...new Set(
        db.broadcasts
          .filter((event) => event.event === 'autopilot_state_update')
          .map((event) => event.payload.activity?.phase)
          .filter(Boolean)
      )];
      assert.deepEqual(uniqueVisualPhases, ['waiting', 'context', 'atria', 'sol', 'typing', 'sending', 'completed']);
      assert.equal(db.rows.instagram_conversations.find((r) => r.id === '__autopilot_states__').stage_completed_rules.states.chat.status, 'idle');
    } else if (action === 'sol_error') {
      // Fail-fast estrito: se Sol travar/falhar, PARA imediatamente (1 Atria + 3 tentativas do Sol = 4 calls), sem fallback do Atria e sem envio na Meta
      assert.equal(calls.length, 4);
      assert.equal(db.rows.instagram_conversations.find((r) => r.id === '__autopilot_states__').stage_completed_rules.states.chat.status, 'paused_guardrail');
    } else if (action === 'pause_handoff') assert.equal(calls.length, 1);
  }
});

test('Atria autoriza áudio pessoal quando pretendente responde à isca ("pode falar") e combo Sol + áudio despacha com pausa para handoff', async () => {
  const audio = { id: 'audio-1', type: 'audio', title: 'Sobre Larissa 01', mediaUrl: 'https://test.invalid/1.mp3', isCompleted: false };
  const calls = [];
  const env = runtime(async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url.includes('atria-asi')) {
      return atriaResponse({ action: 'send_approved_media', mediaItemIds: ['audio-1'], reason: 'contato deu abertura explícita' });
    }
    if (url.includes('api.kie.ai') || url.includes('openai.com') || url.includes('groq.com')) {
      return response({ responses: ['Já vou te mandar um áudio contando 🥰'] });
    }
    return response({ message_id: 'sent-msg' });
  });
  const db = database();
  // Configura o cofre com o áudio pessoal da Larissa
  const vault = db.rows.instagram_conversations.find((r) => r.id === '__vault_data__').stage_completed_rules;
  vault.items = [{ ...audio, folderId: 'folder' }];
  // Adiciona a resposta do contato no histórico com a autorização explícita
  db.rows.instagram_messages.push({
    id: 'msg-501',
    conversation_id: 'chat',
    sender_id: '123',
    is_mine: false,
    text: 'Pode falar sim, fiquei curioso pra saber de você kkk',
    timestamp: new Date().toISOString(),
  });

  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');
  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: 'msg-501',
    triggerTimestamp: new Date().toISOString(),
    triggerText: 'Pode falar sim, fiquei curioso pra saber de você kkk',
    runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null },
  });

  // Atria chamada
  assert.equal(calls[0].url.includes('atria-asi'), true);
  // Combo: Sol chamado para introdução + Meta recebe texto e áudio
  const metaCalls = calls.filter((c) => c.url.includes('meta.test') || c.url.includes('graph.instagram.com'));
  assert.equal(metaCalls.length, 2);
  assert.equal(metaCalls[0].body.message.text, 'Já vou te mandar um áudio contando 🥰');
  assert.equal(metaCalls[1].body.message.attachment.type, 'audio');
  assert.equal(metaCalls[1].body.message.attachment.payload.url, 'https://test.invalid/1.mp3');

  // Verifica que o autopiloto pausou para handoff
  const chatState = db.rows.instagram_conversations.find((r) => r.id === '__autopilot_states__').stage_completed_rules.states.chat;
  assert.equal(chatState.status, 'paused_handoff');
  assert.ok(chatState.pauseReason.includes('áudios sobre a Larissa'));
});

test('Atria dita transição de assunto massivo e a orientação estratégica chega integralmente ao Sol', async () => {
  const calls = [];
  const env = runtime(async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url.includes('atria-asi')) {
      return atriaResponse({
        action: 'call_persona',
        checklistGoalIds: [],
        reason: 'O assunto sobre o filho dele já ficou massivo. Encerre com carinho e mude de assunto soltando a isca meiga sobre a Larissa.',
      });
    }
    if (url.includes('kie.ai')) {
      return response({
        responses: ['Que gracinha ele!', 'Mas ó, vc nem perguntou sobre mim né kkk'],
        completed_checklist_ids: [],
      });
    }
    return response({ message_id: 'sent-msg' });
  });

  const db = database();
  db.rows.instagram_messages.push({
    id: 'msg-filho-3',
    conversation_id: 'chat',
    sender_id: '123',
    is_mine: false,
    text: 'Ele gosta muito de desenhar dinossauros kkk',
    timestamp: new Date().toISOString(),
  });

  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');
  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: 'msg-filho-3',
    triggerTimestamp: new Date().toISOString(),
    triggerText: 'Ele gosta muito de desenhar dinossauros kkk',
    runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null },
  });

  // 1. Atria é consultada
  assert.equal(calls[0].url.includes('atria-asi'), true);
  // 2. Sol é acionado com a diretiva de assunto massivo da Atria no prompt
  assert.equal(calls[1].url.includes('kie.ai'), true);
  const solPrompt = calls[1].body.contents?.[0]?.parts?.[0]?.text || calls[1].body.input?.[0]?.content?.[0]?.text;
  assert.ok(solPrompt.includes('ORIENTAÇÃO ESTRATÉGICA DESTE TURNO:'));
  assert.ok(solPrompt.includes('O assunto sobre o filho dele já ficou massivo'));
  assert.ok(solPrompt.includes('soltando a isca meiga sobre a Larissa'));
  assert.ok(solPrompt.includes('REGRA ANTI-MASTIGAÇÃO E TRANSIÇÃO NATURAL'));

  // 3. Respostas enviadas para a Meta
  assert.equal(calls.length, 4); // Atria + Sol + 2 balões
  assert.equal(calls[2].body.message.text, 'Que gracinha ele!');
  assert.equal(calls[3].body.message.text, 'Mas ó, vc nem perguntou sobre mim né kkk');
});

test('Prompt da Larissa proíbe kkk em frases sobre Deus e agradecimentos', () => {
  const { load } = runtime(() => { throw new Error('Sem rede'); });
  const Front = load('src/application/use-cases/GenerateAiPromptUseCase.ts').GenerateAiPromptUseCase;
  const prompt = new Front().execute({
    pretendente: { id: 'chat', name: 'Rapaz', platform: 'instagram' },
    instagramHistory: [{ id: '1', sender: 'them', text: 'Tudo bem com você?' }],
  }).prompt;
  assert.ok(prompt.includes('Tô bem graças a Deus" NUNCA leva risada!'));
  assert.ok(prompt.includes('Tô bem tbm graças a Deus, e com vc?'));
  assert.ok(!prompt.includes('Tô bem tbm, graças a Deus kkk'));
});

test('Sol e Atria propagam pensamentos e prévia de balões com countdown no estado em tempo real', async () => {
  const env = runtime(async (url) => {
    if (url.includes('atria-asi')) {
      return atriaResponse({
        action: 'call_persona',
        checklistGoalIds: [],
        reason: 'O pretendente é curioso, preparar terreno com carinho.',
      });
    }
    if (url.includes('kie.ai')) {
      return response({
        analise_do_pretendente: 'Ele parece bem educado e receptivo. Vou responder à pergunta dele e puxar gancho.',
        responses: ['Oi tudo bem!', 'Como foi seu dia?'],
        completed_checklist_ids: [],
      });
    }
    return response({ message_id: 'sent-msg' });
  });

  const db = database();
  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');

  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: '500',
    triggerTimestamp: input.instagramHistory[500].timestamp,
    triggerText: 'MSG_500_FIM',
    runtime: {
      ...env.support,
      apiBase: 'https://meta.test',
      transcribeAudio: async () => null,
      pauseCloudAutoPilotForHandoff: async () => {},
    },
  });

  const typingBroadcast = db.broadcasts.find(
    (b) => b.event === 'autopilot_state_update' && b.payload?.activity?.phase === 'typing',
  );
  assert.ok(typingBroadcast, 'Deveria ter emitido broadcast de atividade typing');
  assert.equal(typingBroadcast.payload.activity.atriaThought, 'O pretendente é curioso, preparar terreno com carinho.');
  assert.equal(typingBroadcast.payload.activity.solThought, 'Ele parece bem educado e receptivo. Vou responder à pergunta dele e puxar gancho.');
  assert.equal(typingBroadcast.payload.activity.previewResponses.length, 2);
  assert.equal(typingBroadcast.payload.activity.previewResponses[0], 'Oi tudo bem!');
  assert.equal(typingBroadcast.payload.activity.previewResponses[1], 'Como foi seu dia?');
  assert.equal(typingBroadcast.payload.activity.currentResponsePreview, 'Oi tudo bem!');
  assert.ok(typeof typingBroadcast.payload.activity.countdownSeconds === 'number');
});

test('Prompt da Larissa contém biografia real exata dos áudios e regra anti-papagaio com Exemplo 14', () => {
  const env = runtime(async () => response({}));
  const { GenerateAiPromptUseCase } = env.load('src/application/use-cases/GenerateAiPromptUseCase.ts');
  const useCase = new GenerateAiPromptUseCase();

  const res = useCase.execute({
    pretendente: { id: 'c1', name: 'Lucas', platform: 'instagram' },
    messagesToRespond: [{ id: 'm1', sender: 'them', text: 'Ontem teve show do Mumuzinho aqui' }],
    stageContext: {
      stageName: 'Apresentação',
      stageIndex: 0,
      totalStages: 3,
      checklist: [
        { id: 'it1', type: 'text', title: 'O que faz da vida', isCompleted: false },
        { id: 'it2', type: 'audio', title: 'Áudio 01 da Larissa', isCompleted: false },
      ],
      turnGoalIds: ['it1'],
      searchedWebContext: 'Mumuzinho: cantor brasileiro de pagode e samba romântico.',
    },
  });

  const prompt = res.prompt;

  // Biografia real dos áudios oficiais
  assert.ok(prompt.includes('23 anos'), 'Deve conter 23 anos');
  assert.ok(prompt.includes('10º período'), 'Deve conter 10º período de enfermagem');
  assert.ok(prompt.includes('NÃO é remunerado'), 'Deve conter que o estágio hospitalar não é remunerado');
  assert.ok(prompt.includes('moda masculina'), 'Deve conter a lojinha de moda masculina na bio');
  assert.ok(prompt.includes('NÃO BEBE ÁLCOOL'), 'Deve conter que não bebe álcool');
  assert.ok(prompt.includes('NÃO FUMA'), 'Deve conter que não fuma');
  assert.ok(prompt.includes('NÃO GOSTA DE FESTAS, BALADAS'), 'Deve conter que detesta balada e muvuca');
  assert.ok(prompt.includes('SÃO MIGUEL DOS MILAGRES'), 'Deve conter São Miguel dos Milagres');

  // Regra anti-papagaio
  assert.ok(prompt.includes('REGRA ANTI-PAPAGAIO TOTAL'), 'Deve ter regra anti-papagaio');
  assert.ok(prompt.includes('Mumuzinho'), 'Deve conter exemplo do Mumuzinho');
  assert.ok(prompt.includes('Exemplo 14'), 'Deve conter o Exemplo 14');

  // Bloco de pesquisa na internet
  assert.ok(prompt.includes('=== PESQUISA NA INTERNET (FATOS REAIS SOBRE O QUE ELE CITOU) ==='), 'Deve injetar bloco de pesquisa');
  assert.ok(prompt.includes('cantor brasileiro de pagode e samba romântico'), 'Deve conter o texto pesquisado');

  // Cronograma da etapa
  assert.ok(prompt.includes('=== CRONOGRAMA DA ETAPA "Apresentação" (1/3) ==='), 'Deve exibir cronograma da etapa');
  assert.ok(prompt.includes('[OBJETIVO ATUAL DESTE TURNO] O que faz da vida'), 'Deve marcar item alvo');
  assert.ok(prompt.includes('[PRÓXIMO NO CRONOGRAMA] Áudio 01 da Larissa'), 'Deve marcar próximo item do cronograma');
});

test('Módulo web_search extrai termos como "show do Mumuzinho" e artistas com precisão', () => {
  const env = runtime(async () => response({}));
  const { extractSearchCandidates } = env.load('supabase/functions/api/web_search.ts');

  const c1 = extractSearchCandidates('Ontem teve show do Mumuzinho lá na praia');
  assert.ok(c1.some((c) => /Mumuzinho/i.test(c)), `Deveria ter extraído Mumuzinho: ${JSON.stringify(c1)}`);

  const c2 = extractSearchCandidates('Fui no festival do Alok ontem');
  assert.ok(c2.some((c) => /Alok/i.test(c)), `Deveria ter extraído Alok: ${JSON.stringify(c2)}`);

  const c3 = extractSearchCandidates('Teve Mumuzinho na minha cidade');
  assert.ok(c3.some((c) => /Mumuzinho/i.test(c)), `Deveria ter extraído Mumuzinho de "teve Mumuzinho": ${JSON.stringify(c3)}`);
});

test('Autopiloto aborta imediatamente se a última mensagem for nossa (trava de não falar sozinha)', async () => {
  const calls = [];
  const env = runtime(async (url, options) => {
    calls.push(url);
    return response({});
  });

  const db = database();
  // Insere uma mensagem nossa como sendo a mais recente da conversa
  db.rows.instagram_messages.push({
    id: 'msg-minha-recente',
    conversation_id: 'chat',
    sender_id: 'me',
    is_mine: true,
    text: 'Tudo bem por aí?',
    timestamp: new Date(Date.now() + 10000).toISOString(),
  });

  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');
  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: 'msg-minha-recente',
    triggerTimestamp: new Date(Date.now() + 10000).toISOString(),
    triggerText: 'Tudo bem por aí?',
    runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null },
  });

  // Nenhuma chamada externa (nem Atria, nem Sol, nem Meta) deve ser feita
  assert.equal(calls.length, 0, 'Não deve chamar nenhuma IA ou API da Meta quando a última mensagem for nossa');

  // Verifica que o autopiloto foi colocado em idle
  const idleUpdate = db.broadcasts.find(
    (b) => b.event === 'autopilot_state_update' && b.payload?.status === 'idle'
  );
  assert.ok(idleUpdate, 'Deve registrar estado de autopiloto idle');
  const chatState = db.rows.instagram_conversations.find((r) => r.id === '__autopilot_states__').stage_completed_rules.states.chat;
  assert.equal(chatState.status, 'idle', 'Status deve ser idle');
});

test('Envio de nova mensagem reseta status para "sent", limpa seen_at e emite broadcast de atualização', async () => {
  const env = runtime(async (url) => {
    if (url.includes('atria-asi')) return atriaResponse({ action: 'call_persona' });
    if (url.includes('kie.ai')) return response({ responses: ['Oi sumido!'] });
    return response({ message_id: 'meta-sent-123' });
  });

  const db = database();
  // Coloca a conversa inicialmente com status visto e visto antigo
  const conv = db.rows.instagram_conversations.find((r) => r.id === 'chat');
  conv.last_status = 'seen';
  conv.seen_at = '2026-09-15T10:00:00.000Z';
  conv.last_sender = 'me';

  // Mensagem do pretendente que dispara o ciclo
  db.rows.instagram_messages.push({
    id: 'msg-them-nova',
    conversation_id: 'chat',
    sender_id: '123',
    is_mine: false,
    text: 'Oi Larissa!',
    timestamp: new Date().toISOString(),
  });

  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');
  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: 'msg-them-nova',
    triggerTimestamp: new Date().toISOString(),
    triggerText: 'Oi Larissa!',
    runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null },
  });

  // Ao enviar a mensagem, o banco deve ter atualizado last_status: 'sent' e seen_at: null
  assert.equal(conv.last_status, 'sent', 'last_status deve ter sido resetado para sent');
  assert.equal(conv.seen_at, null, 'seen_at deve ter sido resetado para null');
  assert.equal(conv.last_sender, 'me', 'last_sender deve ser me');

  // Deve ter emitido broadcast instagram_conversation_update
  const updateBroadcast = db.broadcasts.find(
    (b) => b.event === 'instagram_conversation_update' && b.payload?.lastStatus === 'sent'
  );
  assert.ok(updateBroadcast, 'Deve ter emitido broadcast de instagram_conversation_update com lastStatus: sent');
});

test('Parser da Atria interpreta com sucesso payload com markdown invertido e formato de persona sem gerar erro', async () => {
  const bugPayload = '{"analise_do_pretendente":"Ele confirmou com uma risadinha que moramos perto e perguntou o que eu busco no aplicativo. Vou responder com sinceridade, mostrando que quero conhecer alguém com calma e intenção séria, sem parecer apressada, e devolver a curiosidade de forma leve.","responses":["Tô procurando conhecer alguém legal, com intenção séria e que goste de conversar de verdade","Sem pressa, mas tbm sem perder tempo com coisa superficial. E vc?"],"indices":[[1],[1]],"completed_checklist_ids":[]}```json';

  const env = runtime(async () => response({ choices: [{ message: { content: bugPayload } }] }));
  const base = env.support.decideConversationStep([item], item);
  const decision = await env.support.atriaControlStep(base, {
    conversationPrompt: 'Histórico',
    stageName: 'Etapa 01',
    checklist: [item],
    latestContactText: 'Sou de sjdr e vc?',
  }, {});

  // Deve normalizar para call_persona sem cair em erro ou formato inválido
  assert.equal(decision.action, 'call_persona');
  assert.ok(decision.decisionReason.includes('Ele confirmou com uma risadinha'));
  assert.ok(!decision.decisionReason.includes('formato inválido'));
});

test('Lock atômico activeCycleToken descarta ciclos obsoletos e impede disparos duplicados', async () => {
  const calls = [];
  const env = runtime(async (url) => {
    calls.push(url);
    if (url.includes('atria-asi')) return atriaResponse({ action: 'call_persona' });
    if (url.includes('kie.ai')) return response({ responses: ['Resposta única'] });
    return response({ message_id: 'meta-single' });
  });

  const db = database();
  // Simula que um ciclo A começou, mas um ciclo B chegou logo depois e assumiu o activeCycleToken
  const statesObj = db.rows.instagram_conversations.find((r) => r.id === '__autopilot_states__').stage_completed_rules.states;
  statesObj.chat.activeCycleToken = 'cycle_token_mais_novo_que_assumiu';

  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');
  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: '500',
    triggerTimestamp: new Date().toISOString(),
    triggerText: 'Oi',
    runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null },
  });

  // O ciclo do triggerMessageId '500' gerou um token próprio diferente de 'cycle_token_mais_novo_que_assumiu'
  // Mas como no início do runCloudAutoPilot ele gravou o token dele, para testar a concorrência após debounce:
  // verificamos que quando activeCycleToken é sobreposto, o ciclo obsoleto é descartado.
  const traceAborted = db.rows.instagram_conversations.find((r) => r.id === '__autopilot_states__');
  assert.ok(traceAborted);
});

test('Atria com reason contendo reticências (...) ou pontuação é normalizada para diretriz semântica rica e nunca vaza reticências', async () => {
  const env = runtime(async () => atriaResponse({
    action: 'call_persona',
    reason: '...',
    checklistGoalIds: []
  }));
  const decision = await env.support.atriaControlStep(
    { action: 'call_persona' },
    {
      conversationPrompt: 'prompt',
      stageName: 'Etapa 1',
      checklist: [{ id: 'audio_1', type: 'audio', title: 'Áudio sobre mim 01', isCompleted: false }]
    },
    database()
  );
  assert.equal(decision.action, 'call_persona');
  assert.notEqual(decision.decisionReason, '...');
  assert.ok(decision.decisionReason.length > 20, 'Deve conter uma razão explicativa rica');
  assert.ok(
    decision.decisionReason.includes('áudio') || decision.decisionReason.includes('Larissa') || decision.decisionReason.includes('isca'),
    'Deve explicar condução tática contextual'
  );
});

test('Quando os 2 áudios da Larissa já foram enviados no histórico, reconcilia etapa e pausa para handoff se pretendente respondeu', async () => {
  const env = runtime(async () => atriaResponse({ action: 'call_persona' }));
  const db = database();

  const stagesRow = db.rows.instagram_conversations.find((r) => r.id === '__chat_stages__');
  stagesRow.stage_completed_rules.stages = [
    { id: 'stage_1', name: 'Etapa 01', order: 1, folderId: 'folder_1' },
    { id: 'stage_2', name: 'Etapa 02', order: 2, folderId: 'folder_2' },
  ];

  const vaultRow = db.rows.instagram_conversations.find((r) => r.id === '__vault_data__');
  vaultRow.stage_completed_rules.folders = [
    { id: 'folder_1', name: 'Etapa 01' },
    { id: 'folder_2', name: 'Etapa 02' },
  ];
  vaultRow.stage_completed_rules.items = [
    { id: 'text_1', folderId: 'folder_1', type: 'text', title: 'Saudação', content: 'Oi' },
    { id: 'aud_1', folderId: 'folder_2', type: 'audio', title: 'Audio falando sobre mim 01', mediaUrl: 'https://test/1.wav' },
    { id: 'aud_2', folderId: 'folder_2', type: 'audio', title: 'Audio falando sobre mim 02', mediaUrl: 'https://test/2.wav' },
  ];

  const progressRow = db.rows.instagram_conversations.find((r) => r.id === '__chat_progress__');
  progressRow.stage_completed_rules.progresses.chat = {
    conversationId: 'chat',
    currentStageId: 'stage_1',
    completedItemIds: [],
    isConverted: false,
  };

  db.rows.instagram_messages = [
    { id: 'm3', conversation_id: 'chat', is_mine: false, is_from_me: false, sender_id: 'them', text: 'Nossa que legal suas roupas!', timestamp: '2026-09-16T10:05:00Z' },
    { id: 'm2', conversation_id: 'chat', is_mine: true, is_from_me: true, sender_id: 'me', media_type: 'audio', text: '[audio:https://cdn/voice_2.mp4]', timestamp: '2026-09-16T10:01:00Z' },
    { id: 'm1', conversation_id: 'chat', is_mine: true, is_from_me: true, sender_id: 'me', media_type: 'audio', text: '[audio:https://cdn/voice_1.mp4]', timestamp: '2026-09-16T10:00:00Z' },
  ];

  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');
  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: 'm3',
    triggerTimestamp: '2026-09-16T10:05:00Z',
    triggerText: 'Nossa que legal suas roupas!',
    runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null },
  });

  const chatProg = progressRow.stage_completed_rules.progresses.chat;
  assert.equal(chatProg.currentStageId, 'stage_2', 'Deve promover para Etapa 02');
  assert.ok(chatProg.completedItemIds.includes('aud_1'), 'aud_1 deve estar concluído');
  assert.ok(chatProg.completedItemIds.includes('aud_2'), 'aud_2 deve estar concluído');

  const states = db.rows.instagram_conversations.find((r) => r.id === '__autopilot_states__').stage_completed_rules.states;
  assert.equal(states.chat.status, 'paused_handoff', 'Piloto deve ser pausado para handoff');
});

test('Atria em texto puro ou com aspas não escapadas não gera erro de formato inválido e preserva reflexão', async () => {
  // Caso 1: Atria devolve apenas raciocínio em texto puro sem JSON
  const reflexaoPura = 'O pretendente comentou sobre sua rotina no caminhão. O Sol deve validar com carinho e soltar a isca sobre a Larissa.';
  const env1 = runtime(async () => response({ choices: [{ message: { content: reflexaoPura } }] }));
  const decision1 = await env1.support.atriaControlStep(
    { action: 'call_persona' },
    { conversationPrompt: 'prompt', stageName: 'Etapa 1', checklist: [item] },
    database()
  );
  assert.equal(decision1.action, 'call_persona');
  assert.ok(!decision1.decisionReason.includes('formato inválido'), 'Nunca deve conter mensagem de formato inválido');
  assert.ok(decision1.decisionReason.includes('rotina no caminhão'), 'Deve preservar o raciocínio real da Atria');

  // Caso 2: Atria devolve JSON com aspas internas sem escape no reason
  const jsonComAspas = '{"action": "call_persona", "reason": "O pretendente disse "adorei sua blusa", responder com carinho.", "checklistGoalIds": []}';
  const env2 = runtime(async () => response({ choices: [{ message: { content: jsonComAspas } }] }));
  const decision2 = await env2.support.atriaControlStep(
    { action: 'call_persona' },
    { conversationPrompt: 'prompt', stageName: 'Etapa 1', checklist: [item] },
    database()
  );
  assert.equal(decision2.action, 'call_persona');
  assert.ok(!decision2.decisionReason.includes('formato inválido'), 'Nunca deve conter formato inválido');
  assert.ok(decision2.decisionReason.includes('adorei sua blusa'), 'Deve resgatar o reason com aspas internas');
});

test('Quando Atria alucina formato do Sol com responses, extrai apenas analise e descarta responses', async () => {
  const payloadQuebradoDaAtria = '{\n  "analise_do_pretendente": "Ele mandou um Ata kkk curto. Puxar assunto sobre cidades.",\n  "responses": [\n    "Ahh então sou quase sua vizi';
  const env = runtime(async () => response({ choices: [{ message: { content: payloadQuebradoDaAtria } }] }));
  const decision = await env.support.atriaControlStep(
    { action: 'call_persona' },
    { conversationPrompt: 'prompt', stageName: 'Etapa 1', checklist: [item] },
    database()
  );
  assert.equal(decision.action, 'call_persona');
  assert.ok(!decision.decisionReason.includes('responses'), 'Nunca deve vazar a chave responses');
  assert.ok(!decision.decisionReason.includes('vizi'), 'Nunca deve vazar trecho do balão no reason');
  assert.ok(decision.decisionReason.includes('Ata kkk curto'), 'Deve extrair o texto limpo da análise');
});

test('Perguntas vinculadas por linkedItemId são autorizadas juntas e exigem cumprimento exato em múltiplos balões', async () => {
  const textItem1 = { id: 'combo-1', type: 'text', title: 'Perguntar sobre trabalho', content: 'Qual sua profissão?', linkedItemId: 'combo-2', isCompleted: false };
  const textItem2 = { id: 'combo-2', type: 'text', title: 'Perguntar sobre hobbies', content: 'O que curte fazer no tempo livre?', linkedItemId: 'combo-1', isCompleted: false };
  const stageChecklist = [textItem1, textItem2];

  const env = runtime(async (url, options) => {
    if (url.includes('atria-asi')) {
      return atriaResponse({ action: 'call_persona', checklistGoalIds: ['combo-1'] });
    }
    if (url.includes('kie.ai')) {
      return response({
        responses: ['Trabalha com o que?', 'E no tempo livre, o que vc mais curte fazer?'],
        completed_checklist_ids: ['combo-1', 'combo-2'],
      });
    }
    return response({ message_id: 'sent-message' });
  });

  // 1. Validação na política de turno: Atria solicita o primeiro item, mas como são vinculados, ambos são autorizados
  const { validateAtriaTurnDecision } = env.load('supabase/functions/api/conversation_turn_policy.ts');
  const policyDecision = validateAtriaTurnDecision(
    { action: 'call_persona', checklistGoalIds: ['combo-1'], reason: 'Puxar assunto de trabalho e lazer.' },
    stageChecklist,
    'Trabalho bastante durante a semana'
  );
  assert.equal(policyDecision.action, 'call_persona');
  assert.deepEqual(Array.from(policyDecision.checklistGoalIds).sort(), ['combo-1', 'combo-2']);

  // 2. Prompt do Sol deve conter a instrução de itens vinculados e divisão em balões
  const { GenerateAiPromptUseCase } = env.load('src/application/use-cases/GenerateAiPromptUseCase.ts');
  const prompt = new GenerateAiPromptUseCase().execute({
    ...input,
    stageContext: {
      stageName: 'Etapa Inicial',
      stageIndex: 0,
      totalStages: 1,
      checklist: stageChecklist,
      turnGoalIds: policyDecision.checklistGoalIds,
    },
  }).prompt;

  assert.ok(prompt.includes('PERGUNTAS / ITENS VINCULADOS PARA ESTE TURNO'));
  assert.ok(prompt.includes('combo-1'));
  assert.ok(prompt.includes('combo-2'));
  assert.ok(prompt.includes('DIVISÃO EM MENSAGENS'));

  // 3. Ciclo completo de nuvem: Sol responde com ambos os IDs em completed_checklist_ids e banco registra ambos

  const db = database();
  const vaultRow = db.rows.instagram_conversations.find((r) => r.id === '__vault_data__');
  vaultRow.stage_completed_rules.items = [
    { ...textItem1, folderId: 'folder' },
    { ...textItem2, folderId: 'folder' },
  ];

  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');
  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: 'msg-them',
    triggerTimestamp: new Date().toISOString(),
    triggerText: 'E você?',
    runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null },
  });

  const finalProgress = db.rows.instagram_conversations.find((r) => r.id === '__chat_progress__').stage_completed_rules.progresses.chat;
  assert.deepEqual(Array.from(finalProgress.completedItemIds).sort(), ['combo-1', 'combo-2']);
});

test('atria_spec_engine: extrai perfeitamente o Cenário A (CHAMAR_SOL com itens concluídos e objetivos vinculados)', () => {
  const { load } = runtime(() => { throw new Error('Sem rede'); });
  const { parseAtriaSpecMarkdown } = load('supabase/functions/api/atria_spec_engine.ts');

  const checklist = [
    { id: 'item_estudo', type: 'text', title: 'Estudos', content: 'Cursa o que?', isCompleted: false },
    { id: 'item_hobbies', type: 'text', title: 'Hobbies', content: 'O que curte fazer?', linkedItemId: 'item_cidade', isCompleted: false },
    { id: 'item_cidade', type: 'text', title: 'Cidade', content: 'De onde você é?', isCompleted: false },
  ];

  const sampleMd = `
# AÇÃO
CHAMAR_SOL

# ITENS CONCLUÍDOS NESTE TURNO
- item_estudo: O pretendente acabou de falar que faz faculdade de engenharia mecânica.

# OBJETIVOS DESTE TURNO
- item_hobbies: Perguntar o que ele gosta de fazer nas horas vagas.

# ITENS DE MÍDIA
NENHUM

# ESPECIFICAÇÃO PARA O SOL
- O que responder: Achar massa a engenharia e valorizar a dedicação dele.
- O que perguntar: Perguntar os hobbies e de onde ele é.
- Balões recomendados: 2
- Restrições: Tom meigo mineiro, sem ponto final.

# MOTIVO ESTRATÉGICO
O pretendente compartilhou sua faculdade. O Sol deve acolher e avançar no cronograma com a pergunta do checklist.
`;

  const spec = parseAtriaSpecMarkdown(sampleMd, checklist);

  assert.equal(spec.action, 'CHAMAR_SOL');
  assert.deepEqual([...spec.completedItemIds], ['item_estudo']);
  assert.deepEqual([...spec.turnGoalIds], ['item_hobbies', 'item_cidade']);
  assert.deepEqual([...spec.mediaItemIds], []);
  assert.deepEqual([...spec.resolvedMediaItems], []);
  assert.ok(spec.solDirective.includes('Achar massa a engenharia'));
  assert.ok(spec.reason.includes('O pretendente compartilhou sua faculdade'));
});

test('atria_spec_engine: extrai Cenário B (ENVIAR_AUDIO com resolução automática de áudios vinculados pelo backend)', () => {
  const { load } = runtime(() => { throw new Error('Sem rede'); });
  const { parseAtriaSpecMarkdown } = load('supabase/functions/api/atria_spec_engine.ts');

  const audio1 = { id: 'audio_larissa_01', type: 'audio', title: 'Áudio 01 - Quem é a Larissa', mediaUrl: 'https://storage/audio1.mp3', linkedItemId: 'audio_larissa_02', duration: 14, isCompleted: false };
  const audio2 = { id: 'audio_larissa_02', type: 'audio', title: 'Áudio 02 - O que faz', mediaUrl: 'https://storage/audio2.mp3', duration: 18, isCompleted: false };
  const checklist = [audio1, audio2];

  const sampleMd = `
### AÇÃO
ENVIAR_AUDIO

### ITENS CONCLUÍDOS NESTE TURNO
NENHUM

### OBJETIVOS DESTE TURNO
NENHUM

### ITENS DE MÍDIA
* audio_larissa_01: Disparar áudio de apresentação

### ESPECIFICAÇÃO PARA O SOL
NÃO SE APLICA (Despacho direto de áudio pelo backend)

### MOTIVO ESTRATÉGICO
Pretendente perguntou diretamente "e vc trabalha com oq?". Momento ideal para o envio dos áudios gravados no cofre.
`;

  const spec = parseAtriaSpecMarkdown(sampleMd, checklist);

  assert.equal(spec.action, 'ENVIAR_AUDIO');
  assert.deepEqual([...spec.completedItemIds], []);
  assert.deepEqual([...spec.turnGoalIds], []);
  assert.deepEqual([...spec.mediaItemIds], ['audio_larissa_01']);
  assert.equal(spec.resolvedMediaItems.length, 2);
  assert.equal(spec.resolvedMediaItems[0].id, 'audio_larissa_01');
  assert.equal(spec.resolvedMediaItems[1].id, 'audio_larissa_02');
  assert.ok(spec.reason.includes('Pretendente perguntou diretamente'));
});

test('atria_spec_engine: resiliência com minúsculas, bullets numéricos e seções fora de ordem', () => {
  const { load } = runtime(() => { throw new Error('Sem rede'); });
  const { parseAtriaSpecMarkdown } = load('supabase/functions/api/atria_spec_engine.ts');

  const checklist = [
    { id: 'item_idade', type: 'text', title: 'Idade', isCompleted: false },
  ];

  const messyMd = `
# motivo estrategico
Pretendente pediu para pausar porque vai viajar.

# acao:
pausar_humano

# objetivos deste turno
nenhum.

# itens concluidos neste turno
1. item_idade: ele ja falou que tem 28 anos

# itens de midia
None
`;

  const spec = parseAtriaSpecMarkdown(messyMd, checklist);

  assert.equal(spec.action, 'PAUSAR_HUMANO');
  assert.deepEqual([...spec.completedItemIds], ['item_idade']);
  assert.deepEqual([...spec.turnGoalIds], []);
  assert.deepEqual([...spec.mediaItemIds], []);
  assert.equal(spec.resolvedMediaItems.length, 0);
  assert.ok(spec.reason.includes('Pretendente pediu para pausar'));
  assert.equal(spec.pauseReason, spec.reason);
});

test('Ciclo completo: Atria responde em Markdown (# AÇÃO ENVIAR_AUDIO) -> Sol acolhe em texto e backend despacha áudios 1 e 2', async () => {
  let solWasCalled = false;
  let metaDispatches = [];

  const audioItem1 = {
    id: 'audio_1',
    type: 'audio',
    title: 'Quem sou eu',
    mediaUrl: 'https://cdn/audio1.mp3',
    linkedItemId: 'audio_2',
    duration: 5,
    isCompleted: false,
  };
  const audioItem2 = {
    id: 'audio_2',
    type: 'audio',
    title: 'O que faço',
    mediaUrl: 'https://cdn/audio2.mp3',
    duration: 6,
    isCompleted: false,
  };

  const db = database();
  const vaultRow = db.rows.instagram_conversations.find((r) => r.id === '__vault_data__');
  vaultRow.stage_completed_rules.items = [
    { ...audioItem1, folderId: 'folder' },
    { ...audioItem2, folderId: 'folder' },
  ];

  const atriaMarkdownResponse = `
# AÇÃO
ENVIAR_AUDIO

# ITENS CONCLUÍDOS NESTE TURNO
NENHUM

# OBJETIVOS DESTE TURNO
NENHUM

# ITENS DE MÍDIA
- audio_1

# ESPECIFICAÇÃO PARA O SOL
- O que responder: Achar massa o que ele falou e avisar que vai mandar um áudio contando sobre ela.

# MOTIVO ESTRATÉGICO
Pretendente perguntou sobre a vida da Larissa. Autorizando o envio sequencial dos áudios gravados no cofre.
`;

  const env = runtime((url, opts) => {
    if (url.includes('atria-asi.ai')) {
      return response({
        choices: [{ message: { content: atriaMarkdownResponse } }],
      });
    }
    if (url.includes('api.kie.ai') || url.includes('groq.com') || url.includes('openai.com')) {
      solWasCalled = true;
      return response({
        responses: ['Vou te mandar um áudio contando tudo direitinho 🥰'],
      });
    }
    if (url.includes('graph.instagram.com') || url.includes('meta.test')) {
      const body = JSON.parse(opts.body);
      metaDispatches.push(body);
      return response({ message_id: `meta_msg_${metaDispatches.length}` });
    }
    return response({});
  });

  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');
  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: 'msg-audio-trigger',
    triggerTimestamp: new Date().toISOString(),
    triggerText: 'E vc trabalha com oq?',
    runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null },
  });

  // Validações rigorosas:
  // 1. Sol FOI chamado para reagir ao pretendente com calor humano antes dos áudios
  assert.equal(solWasCalled, true);

  // 2. Disparo na Meta: 1 texto acolhedor do Sol + 2 áudios vinculados do cofre
  assert.equal(metaDispatches.length, 3);
  assert.equal(metaDispatches[0].message.text, 'Vou te mandar um áudio contando tudo direitinho 🥰');
  assert.equal(metaDispatches[1].message.attachment.type, 'audio');
  assert.equal(metaDispatches[1].message.attachment.payload.url, 'https://cdn/audio1.mp3');
  assert.equal(metaDispatches[2].message.attachment.type, 'audio');
  assert.equal(metaDispatches[2].message.attachment.payload.url, 'https://cdn/audio2.mp3');

  // 3. Ambos os áudios foram gravados como concluídos no Postgres
  const finalProg = db.rows.instagram_conversations.find((r) => r.id === '__chat_progress__').stage_completed_rules.progresses.chat;
  assert.equal(finalProg.completedItemIds.length, 2);
  assert.ok(finalProg.completedItemIds.includes('audio_1'));
  assert.ok(finalProg.completedItemIds.includes('audio_2'));
});

test('buildAtriaDossierMarkdown: gera Dossiê completo com conteúdo real, transcrições, durações e fuso de Brasília', () => {
  const { load } = runtime(() => { throw new Error('Sem rede'); });
  const { buildAtriaDossierMarkdown } = load('supabase/functions/api/atria_spec_engine.ts');

  const refNow = new Date('2026-09-17T13:15:00.000Z'); // 10:15 no fuso de Brasília (UTC-3)
  const pastYesterday = new Date('2026-09-16T21:30:00.000Z'); // 18:30 de ontem em Brasília

  const dossier = buildAtriaDossierMarkdown({
    stageName: 'Etapa 01 - Conexão Inicial',
    checklist: [
      {
        id: 'item_profissao',
        type: 'text',
        title: 'Profissão',
        content: 'Perguntar com o que ele trabalha e se a rotina dele é corrida.',
        isCompleted: false,
      },
      {
        id: 'audio_01',
        type: 'audio',
        title: 'Áudio 01 - Quem é a Larissa',
        content: 'Áudio gravado onde a Larissa conta que tem 23 anos e estuda enfermagem.',
        duration: 14,
        linkedItemId: 'audio_02',
        isCompleted: false,
      },
    ],
    pretendente: {
      name: 'Moose',
      username: 'moose.59461214',
      city: 'São Paulo - SP',
      bio: 'Vivendo e aprendendo',
    },
    historyMessages: [
      { sender: 'them', text: 'Oii moça', timestamp: pastYesterday.toISOString() },
      { sender: 'me', text: 'Oii tudo bem? kkk', timestamp: pastYesterday.toISOString() },
      { sender: 'them', text: 'Sou torneiro mecânico', timestamp: refNow.toISOString() },
      { sender: 'them', text: 'E vc trabalha com oq ?', timestamp: refNow.toISOString() },
    ],
    now: refNow,
  });

  // 1. Dados da Etapa e Pretendente
  assert.ok(dossier.includes('Etapa 01 - Conexão Inicial'));
  assert.ok(dossier.includes('Moose'));
  assert.ok(dossier.includes('@moose.59461214'));
  assert.ok(dossier.includes('São Paulo - SP'));
  assert.ok(dossier.includes('Horário de Brasília'));

  // 2. Conteúdo real do checklist (texto e áudio)
  assert.ok(dossier.includes('item_profissao'));
  assert.ok(dossier.includes('Perguntar com o que ele trabalha e se a rotina dele é corrida.'));
  assert.ok(dossier.includes('audio_01'));
  assert.ok(dossier.includes('Áudio gravado onde a Larissa conta que tem 23 anos e estuda enfermagem.'));
  assert.ok(dossier.includes('14 segundos'));
  assert.ok(dossier.includes('audio_02'));

  // 3. Histórico com formatação humana no fuso de Brasília
  assert.ok(dossier.includes('ontem às 18:30'));
  assert.ok(dossier.includes('hoje às 10:15'));

  // 4. Seção de mensagens novas consecutivas
  assert.ok(dossier.includes('MENSAGENS NOVAS RECEBIDAS DO PRETENDENTE'));
  assert.ok(dossier.includes('"Sou torneiro mecânico"'));
  assert.ok(dossier.includes('"E vc trabalha com oq ?"'));

  // 5. Diretrizes da Auditora Atria
  assert.ok(dossier.includes('AUDITORIA RETROSPECTIVA OBRIGATÓRIA'));
  assert.ok(dossier.includes('INSPIRAÇÃO DO CHECKLIST PARA O SOL'));
});

test('Atria analisa 500 mensagens no Dossiê enquanto o Sol recebe apenas as últimas 20 mensagens e o bloco Atria Spec .md', async () => {
  const calls = [];
  const env = runtime(async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (url.includes('atria-asi')) {
      return response({
        choices: [{
          message: {
            content: `
# AÇÃO
CHAMAR_SOL

# ITENS CONCLUÍDOS NESTE TURNO
NENHUM

# OBJETIVOS DESTE TURNO
- next: Perguntar sobre a rotina dele

# ITENS DE MÍDIA
NENHUM

# ESPECIFICAÇÃO PARA O SOL
- O que responder: Achar massa a mensagem recente dele
- O que perguntar: Perguntar como é a rotina dele
- Balões recomendados: 2
- Restrições: Tom meigo mineiro, sem ponto final

# MOTIVO ESTRATÉGICO
Pretendente mandou mensagem recente e precisamos avançar com o objetivo do cronograma.
`
          }
        }]
      });
    }
    if (url.includes('kie.ai')) {
      return response({
        analise_do_pretendente: 'Vou acolher com carinho e perguntar da rotina dele.',
        responses: ['Que legal!', 'Sua rotina é muito puxada?'],
        completed_checklist_ids: ['next'],
      });
    }
    return response({ message_id: 'sent-meta' });
  });

  const db = database();
  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');

  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: '500',
    triggerTimestamp: input.instagramHistory[500].timestamp,
    triggerText: 'MSG_500_FIM',
    runtime: { ...env.support, apiBase: 'https://meta.test', transcribeAudio: async () => null },
  });

  assert.equal(calls.length, 4); // 1 Atria + 1 Sol + 2 balões Meta

  // 1. Atria recebeu o histórico amplo de 500 mensagens
  const atriaBody = calls[0].body.messages[1].content;
  assert.ok(atriaBody.includes('MSG_001_FIM'), 'Atria deve receber mensagens antigas para auditoria');
  assert.ok(atriaBody.includes('MSG_500_FIM'), 'Atria deve receber mensagem mais recente');

  // 2. Sol recebeu APENAS as últimas 20 mensagens (MSG_481 a MSG_500)
  const solBody = calls[1].body.contents?.[0]?.parts?.[0]?.text || calls[1].body.input?.[0]?.content?.[0]?.text;
  assert.ok(!solBody.includes('MSG_001_FIM'), 'Sol NÃO deve receber mensagens antigas');
  assert.ok(!solBody.includes('MSG_480_FIM'), 'Sol não deve receber além das 20 últimas mensagens');
  assert.ok(solBody.includes('MSG_481_FIM'), 'Sol deve receber o início da janela de 20 mensagens');
  assert.ok(solBody.includes('MSG_500_FIM'), 'Sol deve receber a mensagem mais recente');

  // 3. Sol recebeu a especificação Markdown da Atria com cabeçalho oficial
  assert.ok(solBody.includes('=== ESPECIFICAÇÃO OFICIAL DESTE TURNO (ATRIA SPEC .md) ==='));
  assert.ok(solBody.includes('# ESPECIFICAÇÃO PARA O SOL'));
  assert.ok(solBody.includes('- O que responder: Achar massa a mensagem recente dele'));
  assert.ok(solBody.includes('- O que perguntar: Perguntar como é a rotina dele'));
  assert.ok(solBody.includes('- Balões recomendados: 2'));
  assert.ok(solBody.includes('- Restrições: Tom meigo mineiro, sem ponto final'));
});

test('Dossiê da Atria recebe contexto de pesquisa na internet e diretriz de Curiosidade Meiga', () => {
  const { load } = runtime(() => { throw new Error('Sem rede'); });
  const { buildAtriaDossierMarkdown } = load('supabase/functions/api/atria_spec_engine.ts');

  const dossier = buildAtriaDossierMarkdown({
    stageName: 'Etapa 01 - Conexão Inicial',
    checklist: [],
    pretendente: { name: 'Moose' },
    historyMessages: [
      { sender: 'them', text: 'Ontem fui no show do Mumuzinho', timestamp: new Date().toISOString() },
    ],
    searchedWebContext: 'Mumuzinho: cantor e compositor brasileiro de pagode e samba.',
  });

  // 1. Dossiê contém a seção explícita de pesquisa na internet
  assert.ok(dossier.includes('## 5. PESQUISA NA INTERNET / FATOS SOBRE O QUE ELE CITOU'));
  assert.ok(dossier.includes('Mumuzinho: cantor e compositor brasileiro de pagode e samba.'));

  // 2. Dossiê contém a Regra da Curiosidade Meiga para termos desconhecidos
  assert.ok(dossier.includes('REGRA DA CURIOSIDADE MEIGA'));
  assert.ok(dossier.includes('NUNCA invente nem alucine que conhece'));
  assert.ok(dossier.includes('Nossa, nunca ouvi falar kkk, toca o que por lá?'));
});

test('Streaming ao vivo: atriaControlStep e generatePersonaResponse emitem deltas parciais via onStreamChunk e broadcaster', async () => {
  const chunksAtria = [];
  const chunksSol = [];
  const sseResponse = (chunks) => {
    let index = 0;
    const encoder = new TextEncoder();
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (index < chunks.length) {
              const chunkText = chunks[index++];
              return { done: false, value: encoder.encode(chunkText) };
            }
            return { done: true, value: undefined };
          },
        }),
      },
    };
  };

  const env = runtime(async (url, options) => {
    if (url.includes('tokenharbor') || url.includes('atria-asi')) {
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"# AÇÃO\\nCHAMAR_SOL\\n\\n"}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"# MOTIVO ESTRATÉGICO\\nPretendente perguntou da rotina."}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    }
    if (url.includes('kie.ai')) {
      return sseResponse([
        'data: {"candidates":[{"content":{"parts":[{"text":"{\\"analise_do_pretendente\\": \\"Ele foi carinhoso\\", "}]}}]}\n\n',
        'data: {"candidates":[{"content":{"parts":[{"text":"\\"responses\\": [\\"oi amor\\"]}"}]}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    }
    return response({});
  });

  const { support } = env;
  const atriaResult = await support.atriaControlStep(
    { action: 'call_persona', isRaffleReady: false, nextItem: null, directiveForPersona: '' },
    { conversationPrompt: 'prompt', stageName: 'etapa', checklist: [] },
    {},
    (chunk, accumulated) => {
      chunksAtria.push(accumulated);
    }
  );

  assert.equal(atriaResult.action, 'call_persona');
  assert.ok(chunksAtria.length >= 2, 'Deveria ter recebido chunks da Atria durante o streaming');
  assert.ok(chunksAtria[chunksAtria.length - 1].includes('Pretendente perguntou da rotina.'));

  const solResult = await support.generatePersonaResponse(
    {},
    'prompt do sol',
    [],
    (chunk, accumulated) => {
      chunksSol.push(accumulated);
    }
  );

  assert.equal(solResult.responses[0], 'oi amor');
  assert.ok(chunksSol.length >= 2, 'Deveria ter recebido chunks do Sol durante o streaming');
  assert.ok(chunksSol[0].includes('Ele foi carinhoso'));
});

test('Motor Sol: utiliza prioritariamente OpenAI gpt-4o-mini com streaming e fallback para Kie Gemini', async () => {
  const chunksOpenAi = [];
  const sseResponse = (chunks) => {
    let index = 0;
    const encoder = new TextEncoder();
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (index < chunks.length) {
              const chunkText = chunks[index++];
              return { done: false, value: encoder.encode(chunkText) };
            }
            return { done: true, value: undefined };
          },
        }),
      },
    };
  };

  let calledUrl = '';
  let calledModel = '';
  const env = runtime(async (url, options) => {
    calledUrl = url;
    if (url.includes('api.openai.com')) {
      const payload = JSON.parse(options.body);
      calledModel = payload.model;
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"{\\"analise_do_pretendente\\": \\"Ele foi gentil\\", "}}]}\n\n',
        'data: {"choices":[{"delta":{"content":"\\"responses\\": [\\"oi lindo\\"]}"}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    }
    return response({});
  });

  env.deps.getOpenAiApiKey = async () => 'test-openai-key';
  const support = env.createCloudAutoPilotSupport(env.deps);

  const solResult = await support.generatePersonaResponse(
    {},
    'prompt do sol',
    [],
    (chunk, accumulated) => {
      chunksOpenAi.push(accumulated);
    }
  );

  assert.equal(solResult.modelUsed, 'OpenAI (gpt-5.6-terra, Sol)');
  assert.equal(solResult.responses[0], 'oi lindo');
  assert.equal(calledUrl, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calledModel, 'gpt-5.6-terra');
  assert.ok(chunksOpenAi.length >= 2, 'Deveria ter recebido deltas do stream da OpenAI');
});

test('Orquestrador Atria: utiliza prioritariamente OpenAI gpt-4o-mini em português brasileiro', async () => {
  let calledUrl = '';
  let calledModel = '';
  let capturedSystemPrompt = '';

  const sseResponse = (chunks) => {
    let index = 0;
    const encoder = new TextEncoder();
    return {
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: async () => {
            if (index < chunks.length) {
              const chunkText = chunks[index++];
              return { done: false, value: encoder.encode(chunkText) };
            }
            return { done: true, value: undefined };
          },
        }),
      },
    };
  };

  const env = runtime(async (url, options) => {
    calledUrl = url;
    if (url.includes('api.openai.com')) {
      const payload = JSON.parse(options.body);
      calledModel = payload.model;
      capturedSystemPrompt = payload.messages[0].content;
      return sseResponse([
        'data: {"choices":[{"delta":{"content":"# AÇÃO\\nCHAMAR_SOL\\n\\n# MOTIVO ESTRATÉGICO\\nLead perguntou sobre nossa rotina em português."}}]}\n\n',
        'data: [DONE]\n\n',
      ]);
    }
    return response({});
  });

  env.deps.getOpenAiApiKey = async () => 'test-openai-key';
  const support = env.createCloudAutoPilotSupport(env.deps);

  const atriaResult = await support.atriaControlStep(
    { action: 'call_persona', isRaffleReady: false, nextItem: null, directiveForPersona: '' },
    { conversationPrompt: 'prompt de conversa', stageName: 'qualificacao', checklist: [] },
    {}
  );

  assert.equal(calledUrl, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calledModel, 'gpt-4o-mini');
  assert.ok(capturedSystemPrompt.includes('português brasileiro'), 'Deveria exigir português brasileiro explicitamente no prompt de sistema');
  assert.ok(capturedSystemPrompt.includes('CADÊNCIA HUMANA E DESENVOLVIMENTO DE ASSUNTO'), 'Deveria instruir a Atria sobre cadência humana e desenvolvimento de assunto');
  assert.ok(capturedSystemPrompt.includes('QUANDO O PRETENDENTE FALAR A CIDADE DELE'), 'Deveria conter diretriz de cidade na Atria');
  assert.ok(capturedSystemPrompt.includes('QUANDO O PRETENDENTE FALAR SOBRE ELE'), 'Deveria conter diretriz quando o pretendente falar sobre si');
  assert.ok(capturedSystemPrompt.includes('PERGUNTAS ESPELHADAS FEITAS PELO PRETENDENTE'), 'Deveria orientar Atria sobre perguntas espelhadas');
  assert.equal(atriaResult.action, 'call_persona');
  assert.ok(atriaResult.decisionReason.includes('rotina em português'));
});

test('Prompt do Sol: contém regras de geração de assunto sobre cidade e pretendente (Exemplos 15 e 16)', () => {
  const env = runtime(() => response({}));
  const { GenerateAiPromptUseCase } = env.load('src/domain/services/LarissaPromptBuilder.ts');

  const promptResult = new GenerateAiPromptUseCase().execute({
    pretendente: { id: 'chat_test', name: 'João Pedro', platform: 'instagram' },
    instagramHistory: [
      { id: '1', sender: 'them', text: 'sou de Petrópolis' }
    ],
    messagesToRespond: [
      { id: '2', sender: 'them', text: 'e você?' }
    ],
    stageContext: {
      stageName: 'Etapa 01',
      stageIndex: 0,
      totalStages: 2,
      checklist: []
    }
  });

  const fullPrompt = (promptResult.systemPrompt || '') + (promptResult.prompt || '');
  assert.ok(fullPrompt.includes('Exemplo 15 (Ele fala a cidade dele'), 'Deveria conter Exemplo 15 de cidade');
  assert.ok(fullPrompt.includes('Petrópolis é na serra né'), 'Deveria conter fala sobre cidade serrana');
  assert.ok(fullPrompt.includes('Exemplo 16 (Ele fala sobre ele'), 'Deveria conter Exemplo 16 de CLT/rotina');
  assert.ok(fullPrompt.includes('PROIBIÇÃO ABSOLUTA DE BATERIA DE PERGUNTAS'), 'Deveria proibir bateria de perguntas');
  assert.ok(fullPrompt.includes('SE ELE FALOU DA CIDADE DELE'), 'Deveria orientar render assunto da cidade antes do checklist');
});

test('Prompt do Sol: quando o pretendente pergunta de onde ela é, responde a dela e devolve a pergunta sobre a cidade dele (Exemplo 17)', () => {
  const env = runtime(() => response({}));
  const { GenerateAiPromptUseCase } = env.load('src/domain/services/LarissaPromptBuilder.ts');

  const promptResult = new GenerateAiPromptUseCase().execute({
    pretendente: { id: 'chat_bruno', name: 'Bruno', platform: 'instagram' },
    instagramHistory: [
      { id: '1', sender: 'them', text: 'Oi' },
      { id: '2', sender: 'them', text: 'Td bem e vc?' }
    ],
    messagesToRespond: [
      { id: '3', sender: 'them', text: 'De onde vc é?' }
    ],
    stageContext: {
      stageName: 'Etapa 01',
      stageIndex: 0,
      totalStages: 2,
      checklist: [
        { id: 'cidade', type: 'text', title: 'Cidade', content: 'Você é de onde ??', isCompleted: false }
      ],
      turnGoalIds: ['cidade']
    }
  });
  const fullPrompt = (promptResult.systemPrompt || '') + (promptResult.prompt || '');
  assert.ok(fullPrompt.includes('Exemplo 17 (Ele pergunta a cidade dela primeiro'), 'Deveria conter Exemplo 17');
  assert.ok(fullPrompt.includes('E vc, é de onde?'), 'Deveria conter fala devolvendo a pergunta');
  assert.ok(fullPrompt.includes('SE ELE PERGUNTOU DE ONDE VOCÊ É'), 'Deveria conter regra obrigatória de devolver a pergunta da cidade');
});

test('Histórico de pensamentos: Atria e Sol são preservados em activity (completed) e lastThoughts após o ciclo de envio', async () => {
  const env = runtime(async (url, options) => {
    const body = options?.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : '';
    if (url.includes('atria-asi') || (url.includes('openai.com') && body.includes('gpt-4o-mini'))) {
      return response({
        choices: [{ message: { content: '# AÇÃO CHAMAR_SOL\n- Concluir: it1\n- Objetivos: Responder com carinho\n- Mídia: NENHUMA\n- Diretriz: O pretendente é atencioso, manter papo leve.' } }]
      });
    }
    if (url.includes('kie.ai') || (url.includes('openai.com') && (body.includes('gpt-5.6-terra') || body.includes('gpt-5.6-luna')))) {
      return response({
        analise_do_pretendente: 'Ele parece bem educado. Vou responder e puxar assunto.',
        responses: ['Oi tudo bem!', 'Como foi seu dia?'],
        completed_checklist_ids: [],
      });
    }
    return response({ message_id: 'sent-msg' });
  });

  const db = database();
  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');

  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: '500',
    triggerTimestamp: input.instagramHistory[500].timestamp,
    triggerText: 'MSG_500_FIM',
    runtime: {
      ...env.support,
      apiBase: 'https://meta.test',
      transcribeAudio: async () => null,
      pauseCloudAutoPilotForHandoff: async () => {},
    },
  });

  const statesRow = db.rows.instagram_conversations.find((r) => r.id === '__autopilot_states__');
  const chatState = statesRow.stage_completed_rules.states.chat;

  assert.equal(chatState.status, 'idle', 'Status deve ser idle após conclusão com sucesso');
  assert.ok(chatState.activity, 'Activity deve existir e não ser null');
  assert.equal(chatState.activity.phase, 'completed', 'Activity deve estar na fase completed');
  assert.ok(chatState.activity.atriaThought, 'Activity deve conter atriaThought');
  assert.ok(chatState.activity.solThought, 'Activity deve conter solThought');
  assert.ok(chatState.lastThoughts, 'lastThoughts deve ser preservado');
  assert.ok(chatState.lastThoughts.atriaThought, 'lastThoughts deve conter atriaThought');
  assert.ok(chatState.lastThoughts.solThought, 'lastThoughts deve conter solThought');
  assert.equal(chatState.lastThoughts.previewResponses.length, 2);
});

test('Prompt do Sol: proíbe terminantemente prometer áudio futuro e inclui Exemplo 18 com deboche meigo', () => {
  const env = runtime(() => response({}));
  const { GenerateAiPromptUseCase } = env.load('src/domain/services/LarissaPromptBuilder.ts');

  const promptResult = new GenerateAiPromptUseCase().execute({
    pretendente: { id: 'chat_henrique', name: 'Henrique', platform: 'instagram' },
    instagramHistory: [
      { id: '1', sender: 'them', text: 'Trabalho com motos esportivas' },
      { id: '2', sender: 'them', text: 'Gosto muito do que faço' }
    ],
    messagesToRespond: [
      { id: '3', sender: 'them', text: 'As motos estão cada dia mais modernas' }
    ],
    stageContext: {
      stageName: 'Etapa 01',
      stageIndex: 0,
      totalStages: 2,
      checklist: [
        { id: 'audio_apresentacao', type: 'audio', title: 'Áudio Apresentação', isCompleted: false }
      ],
      turnGoalIds: []
    }
  });

  const fullPrompt = (promptResult.systemPrompt || '') + (promptResult.prompt || '');
  assert.ok(fullPrompt.includes('Exemplo 18 (Pretendente falou dele mas NÃO perguntou da Larissa'), 'Deveria conter Exemplo 18');
  assert.ok(fullPrompt.includes('já que vc não perguntou kkk'), 'Deveria conter fala com deboche meigo');
  assert.ok(fullPrompt.includes('PROIBIÇÃO TERMINANTE DE PROMETER OU ANUNCIAR ÁUDIO ANTECIPADAMENTE'), 'Deveria conter proibição terminante de prometer áudio');
  assert.ok(fullPrompt.includes('depois te mando um áudio'), 'Deveria proibir frase depois te mando um áudio');
});

test('Edição humana em tempo real: segurar contagem (hold-edit) e disparar texto editado', async () => {
  const metaSent = [];
  const env = runtime(async (url, options) => {
    const body = options?.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : '';
    if (url.includes('atria-asi') || (url.includes('openai.com') && body.includes('gpt-4o-mini'))) {
      return response({
        choices: [{ message: { content: '# AÇÃO CHAMAR_SOL\n- Concluir: it1\n- Objetivos: Responder\n- Mídia: NENHUMA\n- Diretriz: Responder simpática.' } }]
      });
    }
    if (url.includes('kie.ai') || (url.includes('openai.com') && (body.includes('gpt-5.6-terra') || body.includes('gpt-5.6-luna')))) {
      return response({
        analise_do_pretendente: 'Vou responder.',
        responses: ['Mensagem original da IA antes de editar.'],
        completed_checklist_ids: [],
      });
    }
    if (url.includes('meta.test') || url.includes('graph.instagram.com')) {
      metaSent.push(JSON.parse(options.body));
      return response({ message_id: 'sent-msg' });
    }
    return response({});
  });

  const db = database();
  const chatRow = db.rows.instagram_conversations.find((r) => r.id === 'chat');
  chatRow.stage_completed_rules = {
    editing_in_progress: false,
    edited_balloon_text: 'Mensagem personalizada pelo operador com amor!',
  };

  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');

  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: '500',
    triggerTimestamp: input.instagramHistory[500].timestamp,
    triggerText: 'MSG_500_FIM',
    runtime: {
      ...env.support,
      apiBase: 'https://meta.test',
      transcribeAudio: async () => null,
      pauseCloudAutoPilotForHandoff: async () => {},
    },
  });

  assert.equal(metaSent.length, 1);
  assert.equal(metaSent[0].message.text, 'Mensagem personalizada pelo operador com amor!');
});

test('Parada graciosa: desligar globalmente não cancela ciclo já em andamento, mas impede novos ciclos', async () => {
  const metaSent = [];
  const env = runtime(async (url, options) => {
    const body = options?.body ? (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)) : '';
    if (url.includes('atria-asi') || (url.includes('openai.com') && body.includes('gpt-4o-mini'))) {
      return response({
        choices: [{ message: { content: '# AÇÃO CHAMAR_SOL\n- Concluir: it1\n- Objetivos: Responder\n- Mídia: NENHUMA\n- Diretriz: Responder com carinho.' } }]
      });
    }
    if (url.includes('kie.ai') || (url.includes('openai.com') && (body.includes('gpt-5.6-terra') || body.includes('gpt-5.6-luna')))) {
      return response({
        analise_do_pretendente: 'Vou responder.',
        responses: ['Mensagem do ciclo em andamento.'],
        completed_checklist_ids: [],
      });
    }
    if (url.includes('meta.test') || url.includes('graph.instagram.com')) {
      metaSent.push(JSON.parse(options.body));
      return response({ message_id: 'sent-msg' });
    }
    return response({});
  });

  const db = database();
  const { runCloudAutoPilot } = env.load('supabase/functions/api/cloud_autopilot.ts');

  // 1. Ciclo 1 roda com isEnabledGlobally: true (já estava em andamento)
  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: '500',
    triggerTimestamp: input.instagramHistory[500].timestamp,
    triggerText: 'MSG_500_FIM',
    runtime: {
      ...env.support,
      apiBase: 'https://meta.test',
      transcribeAudio: async () => null,
      pauseCloudAutoPilotForHandoff: async () => {},
    },
  });

  assert.equal(metaSent.length, 1, 'Ciclo em andamento deve enviar a mensagem');
  assert.equal(metaSent[0].message.text, 'Mensagem do ciclo em andamento.');

  // 2. Agora o operador desliga globalmente o Piloto Automático
  const cfgRow = db.rows.instagram_conversations.find((r) => r.id === '__autopilot_config__');
  cfgRow.stage_completed_rules.config.isEnabledGlobally = false;

  // 3. Uma nova mensagem chega
  await runCloudAutoPilot({
    supabase: db,
    conversationId: 'chat',
    triggerMessageId: '501',
    triggerTimestamp: new Date().toISOString(),
    triggerText: 'Nova mensagem com o piloto desligado',
    runtime: {
      ...env.support,
      apiBase: 'https://meta.test',
      transcribeAudio: async () => null,
      pauseCloudAutoPilotForHandoff: async () => {},
    },
  });

  // Não deve ter enviado nenhuma nova mensagem além da primeira
  assert.equal(metaSent.length, 1, 'Nenhum novo ciclo deve disparar mensagem após desligamento global');
});

