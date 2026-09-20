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

async function run() {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  const atriaKeyMatch = envContent.match(/ATRIA_API_KEY=(.+)/);
  if (!atriaKeyMatch) throw new Error('ATRIA_API_KEY não encontrada');
  const atriaKey = atriaKeyMatch[1].trim();

  const { load } = createRuntime();
  const { runExperimentalOrchestration } = load('supabase/functions/api/experimental_orchestrator.ts');

  const messages = [];
  const episodes = [];
  let convData = {
    id: 'conv_teste_1',
    full_name: 'Pretendente Teste',
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
          eq: (col, val) => createQuery(curr.filter(m => !m[col] || m[col] === val)),
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
            data: curr.filter(m => vals.includes(m[col])),
            error: null,
            order: () => ({ limit: async () => ({ data: curr.filter(m => vals.includes(m[col])), error: null }) }),
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
              const idx = messages.findIndex(m => m.id === item.id);
              if (idx >= 0) messages[idx] = { ...messages[idx], ...item };
              else messages.push(item);
            }
            return { error: null };
          },
        };
      }
      if (table === 'conversation_episodic_memory') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async (n) => ({ data: episodes.slice(0, n), error: null }),
              }),
              then: (resolve) => resolve({ data: episodes, error: null }),
            }),
            order: () => ({
              limit: async (n) => ({ data: episodes.slice(0, n), error: null }),
            }),
            then: (resolve) => resolve({ data: episodes, error: null }),
          }),
          upsert: async (payloads) => {
            const items = Array.isArray(payloads) ? payloads : [payloads];
            episodes.push(...items);
            return { data: items.map((_, i) => ({ id: `ep_${Date.now()}_${i}` })), error: null };
          },
        };
      }
      return {
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
            order: () => ({ limit: async () => ({ data: [], error: null }) }),
          }),
        }),
        insert: async () => ({ error: null }),
        upsert: async () => ({ error: null }),
        update: () => ({ eq: async () => ({ error: null }) }),
      };
    },
    rpc: async (fnName, params) => {
      if (fnName === 'claim_outbox_entry') {
        const outbox = convData.stage_completed_rules?.orchestration?.outbox || {};
        const entry = outbox[params.p_outbox_id];
        if (entry) {
          entry.status = 'sending';
          entry.claimedBy = params.p_claim_token;
          return { data: { success: true, entry }, error: null };
        }
        return { data: { success: false, reason: 'not_found' }, error: null };
      }
      return { data: null, error: null };
    },
  };

  const runtime = {
    callModel: async (prompt) => {
      console.log('--- CHAMANDO ATRIA --- (Prompt length:', prompt.length, ')');
      const atriaRes = await fetch('https://api.atria-asi.ai/v1/chat/completions', {
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

      if (!atriaRes.ok) {
        throw new Error(`Atria erro HTTP ${atriaRes.status}: ${await atriaRes.text()}`);
      }

      const jsonRes = await atriaRes.json();
      const content = jsonRes.choices?.[0]?.message?.content || '';
      const tokens = jsonRes.usage?.total_tokens || 0;
      console.log('--- ATRIA RESPONDEU --- (Tokens:', tokens, 'Content:', content.slice(0, 150), '...)');
      return { content, tokens };
    },
    sendMetaTextMessage: async (sb, convId, text) => {
      console.log(`[MOCK META OUTBOX DISPATCH] Para conv ${convId}: "${text}"`);
      return { message_id: `meta_msg_${Date.now()}` };
    },
  };

  // Turno 1
  const inbound1 = {
    id: `inbound_${Date.now()}`,
    conversation_id: 'conv_teste_1',
    sender_id: 'them',
    is_mine: false,
    direction: 'inbound',
    text: 'Oi, tudo bem?',
    created_at: new Date().toISOString(),
    timestamp: new Date().toISOString(),
  };
  messages.push(inbound1);

  console.log('Executando Turno 1...');
  const result = await runExperimentalOrchestration({
    supabase,
    conversationId: 'conv_teste_1',
    newMessage: { id: inbound1.id, text: inbound1.text, timestamp: inbound1.timestamp, sender: 'them' },
    runtime,
  });

  console.log('Resultado do Turno 1:', {
    handled: result.handled,
    decision: result.decision,
    durationMs: result.durationMs,
    tokens: result.tokens,
    error: result.error,
  });
}

run().catch(console.error);
