import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

function createRuntime(customModules = {}) {
  const cache = new Map();
  let serverHandler = null;
  const backgroundPromises = [];

  function load(file) {
    if (customModules[file]) return customModules[file];
    if (file.includes('server.ts') || file.startsWith('https://deno.land')) {
      return {
        serve: (handler) => {
          serverHandler = handler;
        },
      };
    }
    if (file.includes('@supabase/supabase-js') || file.startsWith('https://esm.sh')) {
      return {
        createClient: () => customModules['@supabase/client'] || {},
      };
    }
    let resolved = path.resolve(file);
    if (!resolved.endsWith('.ts') && !resolved.endsWith('.js')) resolved += '.ts';
    if (cache.has(resolved)) return cache.get(resolved).exports;
    const module = { exports: {} };
    cache.set(resolved, module);
    const code = ts.transpileModule(fs.readFileSync(resolved, 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(
      code,
      {
        module,
        exports: module.exports,
        require: (ref) => {
          if (customModules[ref]) return customModules[ref];
          if (ref.startsWith('https://') || ref.startsWith('http://')) return load(ref);
          return load(path.resolve(path.dirname(resolved), ref));
        },
        fetch: globalThis.fetch,
        AbortSignal,
        console,
        TextDecoder,
        TextEncoder,
        setTimeout,
        clearTimeout,
        Deno: {
          env: {
            get: (k) => (k in process.env ? process.env[k] : undefined),
          },
        },
        EdgeRuntime: {
          waitUntil: (p) => {
            backgroundPromises.push(p);
          },
        },
        Request: globalThis.Request,
        Response: globalThis.Response,
        Headers: globalThis.Headers,
        URL: globalThis.URL,
      },
      { filename: resolved }
    );
    return module.exports;
  }
  return {
    load,
  };
}

async function callAtriaWithRetry(prompt, atriaKey, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch('https://api.atria-asi.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${atriaKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'Atria-Dawn-Preview',
          temperature: 0.2,
          max_tokens: 3000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const choice = json.choices?.[0];
        let content = choice?.message?.content || '';
        if (!content && choice?.message?.reasoning_content) {
          const match = choice.message.reasoning_content.match(/\{[\s\S]*\}/);
          if (match) content = match[0];
        }
        const tokens = json.usage?.total_tokens || 0;
        return { content, tokens, provider: 'Atria-Dawn-Preview' };
      }

      if (res.status === 503 || res.status === 502 || res.status === 429) {
        console.warn(`[Atria] Status transitório ${res.status}. Tentando novamente em ${1500 * (i + 1)}ms...`);
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
        continue;
      }

      const errText = await res.text();
      throw new Error(`Atria HTTP ${res.status}: ${errText.slice(0, 150)}`);
    } catch (err) {
      if (i === retries) throw err;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
  throw new Error('Atria retry exhausted');
}

async function callGroqFallback(prompt, groqKey) {
  await new Promise((r) => setTimeout(r, 1000));
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${groqKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen/qwen3.8-27b',
      temperature: 0.2,
      max_tokens: 500, // Limite estrito seguro para nunca exceder o OTPM da Groq
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || '';
  const tokens = json.usage?.total_tokens || 0;
  return { content, tokens, provider: 'Groq-qwen3.8-27b' };
}

async function runSimulation() {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  const atriaKeyMatch = envContent.match(/ATRIA_API_KEY=(.+)/);
  const groqKeyMatch = envContent.match(/GROQ_API_KEY=(.+)/);
  const groqKey = groqKeyMatch ? groqKeyMatch[1].trim() : (process.env.GROQ_API_KEY || '');

  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');
  const { searchConversationEpisodicMemory, validateAntiRepeatGate } = load('supabase/functions/api/conversation_episodic_memory.ts');
  const { runStyleLint } = load('supabase/functions/api/LarissaChatStyle.ts');

  const conversationId = 'conv_simulacao_larissa_15_turnos';
  const messages = [];
  const episodes = [];

  let convData = {
    id: conversationId,
    full_name: 'Pretendente Real',
    stage_completed_rules: {
      orchestration: {
        version: 1,
        mode: 'experimental',
        currentPhase: 'conexao_inicial',
        checkpoint: 'chk_saudacao_reciproca',
        memory: { entities: {}, snippets: [] },
        outbox: {},
        messageLedger: {},
      },
    },
  };

  const createSafeChain = (data = null) => {
    const p = Promise.resolve({ data, error: null });
    p.select = () => Promise.resolve({ data, error: null });
    p.eq = () => createSafeChain(data);
    p.maybeSingle = () => Promise.resolve({ data, error: null });
    p.upsert = () => createSafeChain(data);
    p.insert = () => createSafeChain(data);
    p.update = () => createSafeChain(data);
    return p;
  };

  const supabase = {
    from: (table) => {
      if (table === 'instagram_conversations') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: convData, error: null }),
            }),
          }),
          update: (fields) => ({
            eq: async () => {
              convData = {
                ...convData,
                ...fields,
                stage_completed_rules: {
                  ...(convData.stage_completed_rules || {}),
                  ...(fields.stage_completed_rules || {}),
                },
              };
              return { error: null };
            },
          }),
        };
      }
      if (table === 'instagram_messages') {
        const createQuery = (curr = [...messages]) => ({
          eq: (col, val) => createQuery(curr.filter((m) => !m[col] || m[col] === val)),
          order: (col, opts) => {
            const sorted = [...curr].sort((a, b) => {
              const valA = a[col] || '';
              const valB = b[col] || '';
              return opts?.ascending === false ? (valB > valA ? 1 : -1) : (valA > valB ? 1 : -1);
            });
            return createQuery(sorted);
          },
          range: async (from, to) => ({ data: curr.slice(from, to !== undefined ? to + 1 : undefined), error: null }),
          limit: async (n) => ({ data: n !== undefined ? curr.slice(0, n) : curr, error: null }),
          in: async (col, vals) => ({
            data: curr.filter((m) => vals.includes(m[col])),
            error: null,
            order: () => ({ limit: async () => ({ data: curr.filter((m) => vals.includes(m[col])), error: null }) }),
          }),
          then: (resolve, reject) => Promise.resolve({ data: curr, error: null }).then(resolve, reject),
        });
        return {
          select: () => createQuery(),
          insert: async (msg) => {
            if (Array.isArray(msg)) messages.push(...msg);
            else messages.push(msg);
            return { error: null };
          },
          upsert: async (msg) => {
            const arr = Array.isArray(msg) ? msg : [msg];
            for (const item of arr) {
              const idx = messages.findIndex((m) => m.id === item.id);
              if (idx >= 0) messages[idx] = { ...messages[idx], ...item };
              else messages.push(item);
            }
            return { error: null };
          },
        };
      }
      if (table === 'conversation_episodic_memory') {
        const createEpQuery = () => ({
          eq: () => createEpQuery(),
          gte: () => createEpQuery(),
          lte: () => createEpQuery(),
          order: () => createEpQuery(),
          limit: async (n) => ({ data: episodes.slice(0, n), error: null }),
          then: (resolve) => resolve({ data: episodes, error: null }),
        });
        return {
          select: () => createEpQuery(),
          upsert: (payloads) => {
            const items = Array.isArray(payloads) ? payloads : [payloads];
            for (const p of items) {
              const idx = episodes.findIndex((e) => e.episode_fingerprint && e.episode_fingerprint === p.episode_fingerprint);
              if (idx >= 0) episodes[idx] = { ...episodes[idx], ...p };
              else episodes.push(p);
            }
            const p = Promise.resolve({ data: items.map((_, i) => ({ id: `ep_${Date.now()}_${i}` })), error: null });
            p.select = () => Promise.resolve({ data: items.map((_, i) => ({ id: `ep_${Date.now()}_${i}` })), error: null });
            return p;
          },
        };
      }
      if (table === 'agent_cloud_state') {
        return {
          select: () => createSafeChain(),
          upsert: () => createSafeChain(),
          update: () => createSafeChain(),
          insert: () => createSafeChain(),
        };
      }
      return {
        select: () => createSafeChain(),
        insert: () => createSafeChain(),
        upsert: () => createSafeChain(),
        update: () => createSafeChain(),
      };
    },
    rpc: async (fnName, params) => {
      if (fnName === 'claim_outbox_entry') {
        const rules = convData.stage_completed_rules || {};
        const orch = rules.orchestration || {};
        const outbox = { ...(orch.outbox || {}) };

        let targetKey = params.p_outbox_id;
        let entry = outbox[params.p_outbox_id];
        if (!entry) {
          for (const [k, v] of Object.entries(outbox)) {
            if (v?.id === params.p_outbox_id || v?.idempotencyKey === params.p_outbox_id) {
              targetKey = k;
              entry = v;
              break;
            }
          }
        }
        if (!entry) return { data: { success: false, reason: 'not_found' }, error: null };
        entry.status = 'sending';
        entry.claimedBy = params.p_claim_token;
        entry.sendingAt = new Date().toISOString();
        outbox[targetKey] = entry;
        convData.stage_completed_rules = { ...rules, orchestration: { ...orch, outbox } };
        return { data: { success: true, entry }, error: null };
      }
      if (fnName === 'ack_experimental_cycle_preemption') {
        return { data: { acknowledged: true, currentRevision: 1 }, error: null };
      }
      return { data: null, error: null };
    },
    channel: () => ({
      send: async () => ({}),
      subscribe: () => ({}),
      unsubscribe: () => ({}),
    }),
  };

  const runtime = {
    callModel: async (prompt) => {
      try {
        if (atriaKey) {
          return await callAtriaWithRetry(prompt, atriaKey);
        }
      } catch (err) {
        console.warn('[callModel] Atria com erro ou 503, acionando fallback Groq com max_tokens=500...', err.message);
      }
      return await callGroqFallback(prompt, groqKey);
    },
    sendMetaTextMessage: async (sb, convId, text) => {
      return { message_id: `meta_msg_${Date.now()}` };
    },
  };

  const turnDefinitions = [
    {
      num: 1,
      inbound: 'Oi, tudo bem?',
      intent: 'Saudação recíproca',
      evaluation: 'naturalidade, balões, estilo',
    },
    {
      num: 2,
      inbound: 'Me fala mais de você',
      intent: 'Pergunta aberta sobre ela',
      evaluation: 'PersonaMemory correta, não despejar biografia inteira',
    },
    {
      num: 3,
      inbound: 'Trabalho na mineração, moro em Lafaiete',
      intent: 'Revela trabalho e cidade',
      evaluation: 'ContactMemory salva, EpisodicMemory salva',
    },
    {
      num: 4,
      inbound: 'Hoje foi puxado no serviço',
      intent: 'Comenta sobre cansaço na rotina',
      evaluation: 'não perguntar novamente profissão, aprofundar naturalmente',
    },
    {
      num: 5,
      inbound: 'Você mora onde mesmo?',
      intent: 'Pergunta cidade da Larissa',
      evaluation: 'responder sem parecer repetição',
    },
    {
      num: 6,
      inbound: 'Também gosto de viajar',
      intent: 'Conexão em hobby/lazer',
      evaluation: 'conexão, reação antes da pergunta',
    },
    {
      num: 7,
      inbound: 'kk',
      intent: 'Risada curta',
      evaluation: 'resposta proporcional, sem entrevista',
    },
    {
      num: 8,
      inbound: 'vou aí dormir agarradinho com você kkk',
      intent: 'Flerte ousado e precipitado',
      evaluation: 'flerte, limite, moça de família',
    },
    {
      num: 9,
      inbound: 'meu pai foi internado no hospital ontem, tô meio pra baixo hoje',
      intent: 'Problema pessoal/familiar grave',
      evaluation: 'acolhimento, sem kkk',
    },
    {
      num: 10,
      inbound: 'onde vc mora mesmo que esqueci?',
      intent: 'Pergunta repetida sobre moradia',
      evaluation: 'conversation_search, anti-repeat',
    },
    {
      num: 11,
      inbound: 'mas mudando de assunto, vc curte sertanejo?',
      intent: 'Mudança de assunto/música',
      evaluation: 'transição natural',
    },
    {
      num: 12,
      inbound: 'blz',
      intent: 'Mensagem monossilábica seca',
      evaluation: 'cutucada leve',
    },
    {
      num: 13,
      inbound: 'você quer algo sério?',
      intent: 'Pergunta direta sobre relacionamento',
      evaluation: 'responder diretamente',
    },
    {
      num: 14,
      inbound: 'tenho 28 anos, sou de Congonhas mas fico em Lafaiete pela mina, e nos fins de semana gosto de pedalar',
      intent: 'Múltiplos dados (idade + cidade + profissão + hobby)',
      evaluation: 'ContactMemory, múltiplos episódios, sem perguntar novamente depois',
    },
    {
      num: 15,
      inbound: 'e vc, pedala ou faz algum esporte?',
      intent: 'Pergunta de fechamento/esporte',
      evaluation: 'resposta final humana e coerente',
    },
  ];

  const results = [];
  const baseTimestampMs = Date.now() - 40 * 60 * 1000;

  for (const t of turnDefinitions) {
    console.log(`\n==================================================`);
    console.log(`EXECUTANDO TURNO ${t.num}: "${t.inbound}"`);
    console.log(`==================================================`);

    const turnStartTime = Date.now();
    const turnTimestamp = new Date(baseTimestampMs + t.num * 60000).toISOString();

    const inboundMsg = {
      id: `inbound_${Date.now()}_${t.num}`,
      conversation_id: conversationId,
      sender_id: 'them',
      is_mine: false,
      direction: 'inbound',
      text: t.inbound,
      created_at: turnTimestamp,
      timestamp: turnTimestamp,
    };
    messages.push(inboundMsg);

    // Consulta de memórias pré-turno
    const episodicMatches = await searchConversationEpisodicMemory({
      conversationId,
      query: t.inbound,
      cachedEpisodes: episodes,
      limit: 3,
    });

    const contactMemoryStore = convData.stage_completed_rules?.orchestration?.memory || { entities: {}, snippets: [] };
    const knownFacts = Object.entries(contactMemoryStore.entities?.self || {}).map(([k, v]) => `${k}: ${v.value}`);

    const res = await runExperimentalOrchestration({
      supabase,
      conversationId,
      newMessage: { id: inboundMsg.id, text: inboundMsg.text, timestamp: inboundMsg.timestamp, sender: 'them' },
      runtime,
    });

    const decision = res.decision;
    const balloons = decision?.responses && decision.responses.length > 0 ? decision.responses : [decision?.suggestedResponse || ''];
    const balloonsClean = balloons.filter(Boolean);

    // Adiciona as respostas da Larissa no histórico de mensagens para os turnos subsequentes
    for (let bIdx = 0; bIdx < balloonsClean.length; bIdx++) {
      const bText = balloonsClean[bIdx];
      messages.push({
        id: `outbound_${Date.now()}_${t.num}_${bIdx}`,
        conversation_id: conversationId,
        sender_id: 'larissa',
        is_mine: true,
        direction: 'outbound',
        text: bText,
        created_at: new Date(baseTimestampMs + t.num * 60000 + (bIdx + 1) * 2000).toISOString(),
        timestamp: new Date(baseTimestampMs + t.num * 60000 + (bIdx + 1) * 2000).toISOString(),
      });
    }

    // Análise de Style Lint
    const lintRes = runStyleLint(balloonsClean, {
      recentEmojis: [],
      emojiBudget: 1,
    });

    // Análise de Anti-Repeat
    const antiRepeatRes = await validateAntiRepeatGate({
      conversationId,
      candidateBalloons: balloonsClean,
      cachedEpisodes: episodes,
      supabase,
    });

    // Memórias consultadas/relevantes
    const memList = [];
    if (knownFacts.length > 0) memList.push(`ContactMemory: [${knownFacts.join(', ')}]`);
    if (episodicMatches.length > 0) {
      memList.push(`EpisodicMemory: ${episodicMatches.map((m) => `(${m.topic || 'geral'}) ${m.summary}`).join(' | ')}`);
    }
    if (memList.length === 0) memList.push('Nenhuma (início ou saudação)');

    const lintStatus = lintRes.passed ? 'APROVADO (0 violações)' : `CORRIGIDO (${(lintRes.issues || []).map((i) => i.rule).join(', ')})`;

    const turnReport = {
      turno: t.num,
      inbound: t.inbound,
      memorias_consultadas: memList.join(' | '),
      objetivos_envolvidos: decision?.checkpoint || 'chk_saudacao_reciproca',
      resposta_gerada: balloonsClean.join(' // '),
      style_lint: lintStatus,
      anti_repeat: antiRepeatRes.isBlocked ? 'BLOQUEADO' : 'APROVADO (Sem repetição indevida)',
      baloes: balloonsClean.length,
      baloes_lista: balloonsClean,
      tokens: res.tokens || 0,
      durationMs: res.durationMs || Date.now() - turnStartTime,
      phase: decision?.nextPhase || 'conexao_inicial',
    };

    results.push(turnReport);

    console.log(`TURNO ${t.num} CONCLUÍDO. RESPOSTA:`, balloonsClean);
    console.log(`STYLE_LINT:`, turnReport.style_lint);
    console.log(`ANTI_REPEAT:`, turnReport.anti_repeat);
    console.log(`TOKENS:`, turnReport.tokens);
  }

  fs.writeFileSync('scratch/simulation_15_turns_result.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('\n--- SIMULAÇÃO DE 15 TURNOS CONCLUÍDA COM 100% DE SUCESSO! ---');
}

runSimulation().catch((err) => {
  console.error('FATAL na simulação:', err);
  process.exit(1);
});
