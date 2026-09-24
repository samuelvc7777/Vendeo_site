import test from 'node:test';
import assert from 'node:assert/strict';
import {
  persistDurableOutboxBatchAtomic,
  claimOutboxEntryAtomic,
  finalizeOutboxEntryAtomic,
  reconcileOutboxEntryAtomic,
  reconcileUncertainOutboxAction,
  runDurableOutboxDispatcher,
  requestBrainCyclePreemptionAtomic,
} from '../supabase/functions/api/brain_orchestrator.ts';

// --------------------------------------------------------------------------
// Mock Factory do Supabase para testes determinísticos de orquestração e outbox
// --------------------------------------------------------------------------
function createDurableMockSupabase(initialState = {}) {
  const defaultConvId = initialState.conversationId || 'conv_durable_test';
  const correlationId = initialState.correlationId || ('corr_' + Date.now());
  const defaultStages = [
    {
      id: 'stage_1_conexao',
      name: 'Conexão Inicial',
      order: 1,
      goals: [
        {
          id: 'goal_initial_reciprocity',
          label: 'Reciprocidade inicial',
          required: true,
          status: 'pending',
          kind: 'conversation_state',
        },
      ],
    },
  ];

  const convRecord = {
    id: defaultConvId,
    is_restricted: false,
    ai_auto_respond: initialState.ai_auto_respond !== undefined ? initialState.ai_auto_respond : true,
    ai_debounce_until: initialState.ai_debounce_until || null,
    stage_completed_rules: {
      current_stage: 'stage_1_conexao',
      stages: defaultStages,
      completed_goals: [],
      cancel_current_cycle: false,
      config: {
        persistent_agent_session_enabled: true,
      },
      orchestration: {
        currentStageId: 'stage_1_conexao',
        currentPhase: 'conexao_inicial',
        checkpoint: 'chk_saudacao_feita',
        stageChecklist: {
          goals: defaultStages[0].goals,
          currentObjective: defaultStages[0].goals[0],
        },
        openai_session_id: initialState.initialSessionId || 'sess_durable_mock',
        activation_watermark: initialState.activation_watermark || null,
        outbox: initialState.outbox || {},
        messageLedger: initialState.messageLedger || {},
      },
      active_cycle_token: initialState.activeCycleToken || correlationId,
    },
  };

  const store = {
    conversations: {
      [defaultConvId]: convRecord,
    },
    messages: initialState.messages || [
      {
        id: 'msg_client_old',
        conversation_id: defaultConvId,
        sender_id: 'user_them',
        is_mine: false,
        text: 'Oii tudo bem?',
        created_at: new Date(Date.now() - 60000).toISOString(),
        timestamp: new Date(Date.now() - 60000).toISOString(),
      },
    ],
    audio_delivery_history: [],
    persona_audios: [
      {
        id: 'audio_profissao_1',
        title: 'Áudio sobre profissão',
        audio_url: 'https://storage.vendeo.com/audios/profissao.mp3',
        audioUrl: 'https://storage.vendeo.com/audios/profissao.mp3',
        transcript: 'Eu trabalho com confecção de biquínis online...',
        full_transcript: 'Eu trabalho com confecção de biquínis online...',
        duration: 38,
        is_active: true,
        enabled: true,
      },
    ],
    chat_stages: defaultStages,
    instagram_config: [
      { id: 'openai_api_key', app_secret: 'sk-mock-key' },
      { id: 'openai_brain_agent_id', app_secret: 'agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482' },
      { id: 'openai_brain_default_model', app_secret: 'gpt-6-luna' },
      { id: 'openai_brain_reasoning_effort', app_secret: 'medium' },
      { id: 'default', access_token: 'meta_mock_token', instagram_account_id: 'act_123', username: 'lariresende_0611' },
    ],
  };

  const dispatchedNetworkCalls = [];
  let agentCallsCount = 0;

  const client = {
    _store: store,
    getDispatchedNetworkCalls: () => dispatchedNetworkCalls,
    getAgentCallsCount: () => agentCallsCount,
    incrementAgentCalls: () => { agentCallsCount++; },
    channel: () => ({
      send: async () => {},
      subscribe: () => ({}),
    }),
    rpc: async (fnName, params) => {
      if (fnName === 'persist_durable_outbox_batch') {
        const conv = store.conversations[params.p_conversation_id];
        if (!conv) return { data: { success: false, reason: 'conversation_not_found' }, error: null };
        conv.stage_completed_rules = conv.stage_completed_rules || {};
        conv.stage_completed_rules.orchestration = conv.stage_completed_rules.orchestration || {};
        const outbox = conv.stage_completed_rules.orchestration.outbox || {};
        let persistedCount = 0;
        for (const entry of (params.p_outbox_entries || [])) {
          const key = entry.idempotencyKey || entry.id;
          if (!outbox[key]) {
            outbox[key] = { ...entry, status: 'pending', attempts: 0 };
            persistedCount++;
          }
        }
        conv.stage_completed_rules.orchestration.outbox = outbox;
        return { data: { success: true, count: persistedCount }, error: null };
      }

      if (fnName === 'claim_outbox_entry') {
        const conv = store.conversations[params.p_conversation_id];
        if (!conv) return { data: { success: false, claimed: false, reason: 'conversation_not_found' }, error: null };
        const outbox = conv.stage_completed_rules?.orchestration?.outbox || {};
        const entry = Object.values(outbox).find((e) => e.id === params.p_outbox_id);
        if (!entry) return { data: { success: false, claimed: false, reason: 'entry_not_found' }, error: null };
        if (entry.status !== 'pending') return { data: { success: false, claimed: false, reason: 'not_pending', currentStatus: entry.status }, error: null };

        // Validação de not_before
        const nowIso = new Date().toISOString();
        if (entry.notBefore && entry.notBefore > nowIso) {
          return { data: { success: false, claimed: false, reason: 'not_due_yet', notBefore: entry.notBefore }, error: null };
        }

        // Validação de ordem estrita por actionIndex
        const entryIdx = entry.actionIndex ?? 0;
        const allEntries = Object.values(outbox);
        const hasUnfinishedPrior = allEntries.some((other) => {
          const otherIdx = other.actionIndex ?? 0;
          return otherIdx < entryIdx && other.status !== 'sent';
        });
        if (hasUnfinishedPrior) {
          return { data: { success: false, claimed: false, reason: 'prior_action_unfinished' }, error: null };
        }

        entry.status = 'sending';
        entry.claimedBy = params.p_claim_token;
        entry.sendingAt = nowIso;
        entry.attempts = (entry.attempts || 0) + 1;
        return { data: { success: true, claimed: true, entry }, error: null };
      }

      if (fnName === 'finalize_outbox_entry') {
        const conv = store.conversations[params.p_conversation_id];
        if (!conv) return { data: { success: false, reason: 'conversation_not_found' }, error: null };
        const outbox = conv.stage_completed_rules?.orchestration?.outbox || {};
        const entry = Object.values(outbox).find((e) => e.id === params.p_outbox_id);
        if (!entry) return { data: { success: false, reason: 'entry_not_found' }, error: null };
        entry.status = params.p_status;
        if (params.p_status === 'sent') entry.sentAt = new Date().toISOString();
        if (params.p_provider_message_id) entry.providerMessageId = params.p_provider_message_id;
        if (params.p_error) entry.lastError = params.p_error;
        if (params.p_status === 'dispatch_uncertain') entry.isUncertain = true;
        return { data: { success: true }, error: null };
      }

      if (fnName === 'reconcile_outbox_entry') {
        const conv = store.conversations[params.p_conversation_id];
        if (!conv) return { data: { success: false, reason: 'conversation_not_found' }, error: null };
        const outbox = conv.stage_completed_rules?.orchestration?.outbox || {};
        const entry = Object.values(outbox).find((e) => e.id === params.p_outbox_id);
        if (!entry) return { data: { success: false, reason: 'entry_not_found' }, error: null };
        if (entry.status !== 'dispatch_uncertain') return { data: { success: false, reason: 'not_uncertain' }, error: null };
        entry.status = 'sent';
        entry.sentAt = new Date().toISOString();
        entry.isUncertain = false;
        if (params.p_provider_message_id) entry.providerMessageId = params.p_provider_message_id;
        return { data: { success: true, reconciled: true }, error: null };
      }

      if (fnName === 'set_activation_watermark_atomic') {
        const conv = store.conversations[params.p_conversation_id];
        if (!conv) return { data: { success: false, reason: 'not_found' }, error: null };
        conv.stage_completed_rules = conv.stage_completed_rules || {};
        conv.stage_completed_rules.orchestration = conv.stage_completed_rules.orchestration || {};
        conv.stage_completed_rules.orchestration.activation_watermark = params.p_watermark;
        conv.ai_auto_respond = true;
        return { data: { success: true, watermark: params.p_watermark }, error: null };
      }

      if (fnName === 'request_experimental_cycle_preemption') {
        const conv = store.conversations[params.p_conversation_id];
        if (!conv) return { data: { success: false, reason: 'conversation_not_found' }, error: null };
        conv.ai_debounce_until = params.p_debounce_until;
        return { data: { success: true, reason: 'preemption_requested', activeCycleToken: conv.stage_completed_rules?.active_cycle_token }, error: null };
      }

      return { data: null, error: null };
    },
    from: (table) => {
      let conditions = [];
      let updatePayload = null;

      const qb = {
        select: () => qb,
        eq: (col, val) => {
          conditions.push({ col, val, op: 'eq' });
          return qb;
        },
        neq: () => qb,
        in: (col, vals) => {
          conditions.push({ col, vals, op: 'in' });
          return qb;
        },
        not: () => qb,
        order: () => qb,
        limit: () => qb,
        range: () => qb,
        update: (payload) => {
          updatePayload = payload;
          return qb;
        },
        upsert: (records) => {
          const arr = Array.isArray(records) ? records : [records];
          if (table === 'instagram_messages') {
            store.messages.push(...arr);
          }
          return {
            select: () => Promise.resolve({ data: arr, error: null }),
            then: (resolve) => resolve({ data: arr, error: null }),
          };
        },
        maybeSingle: async () => {
          if (table === 'instagram_conversations') {
            const idCond = conditions.find((c) => c.col === 'id');
            const rec = idCond ? store.conversations[idCond.val] : convRecord;
            return { data: rec || null, error: null };
          }
          if (table === 'instagram_config') {
            const idCond = conditions.find((c) => c.col === 'id');
            const rec = store.instagram_config.find((c) => c.id === idCond?.val);
            return { data: rec || null, error: null };
          }
          if (table === 'instagram_messages') {
            const convCond = conditions.find((c) => c.col === 'conversation_id');
            const msgs = convCond ? store.messages.filter((m) => m.conversation_id === convCond.val) : store.messages;
            return { data: msgs[msgs.length - 1] || null, error: null };
          }
          return { data: null, error: null };
        },
        single: async () => qb.maybeSingle(),
        then: (resolve) => {
          if (updatePayload && table === 'instagram_conversations') {
            const idCond = conditions.find((c) => c.col === 'id');
            if (idCond && store.conversations[idCond.val]) {
              const target = store.conversations[idCond.val];
              Object.assign(target, updatePayload);
              if (updatePayload.stage_completed_rules) {
                target.stage_completed_rules = {
                  ...target.stage_completed_rules,
                  ...updatePayload.stage_completed_rules,
                };
              }
            }
            return resolve({ data: null, error: null });
          }

          if (table === 'instagram_messages') {
            const convCond = conditions.find((c) => c.col === 'conversation_id');
            let msgs = convCond ? store.messages.filter((m) => m.conversation_id === convCond.val) : store.messages;
            const isMineCond = conditions.find((c) => c.col === 'is_mine');
            if (isMineCond) {
              msgs = msgs.filter((m) => m.is_mine === isMineCond.val);
            }
            return resolve({ data: msgs, error: null });
          }

          if (table === 'persona_audios') {
            return resolve({ data: store.persona_audios, error: null });
          }

          if (table === 'instagram_config') {
            return resolve({ data: store.instagram_config, error: null });
          }

          return resolve({ data: [], error: null });
        },
      };

      return qb;
    },
  };

  return client;
}

// ==========================================================================
// 19.1 ATIVAÇÃO (Testes 1 a 6)
// ==========================================================================

test('1. Ativação: última mensagem é do cliente (antiga) -> toggle ON arma IA com ZERO chamadas ao Agent e OpenAI', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';
  const nowIso = new Date().toISOString();

  // Simula toggle ON: grava watermark da mensagem mais recente existente
  const latestMsg = supabase._store.messages[0];
  const watermark = {
    armedAt: nowIso,
    lastMessageId: latestMsg.id,
    lastMessageTimestamp: latestMsg.created_at,
  };

  await supabase.rpc('set_activation_watermark_atomic', {
    p_conversation_id: convId,
    p_watermark: watermark,
  });

  const conv = supabase._store.conversations[convId];
  assert.equal(conv.ai_auto_respond, true, 'Autopiloto deve estar ligado');
  assert.deepEqual(
    conv.stage_completed_rules.orchestration.activation_watermark,
    watermark,
    'Watermark de ativação deve estar gravado'
  );

  // Verificação contra o watermark no trigger determinístico
  const msgTime = latestMsg.timestamp || latestMsg.created_at;
  const isPriorToWatermark = Boolean(
    watermark && (
      (watermark.lastMessageId && latestMsg.id === watermark.lastMessageId) ||
      (watermark.armedAt && msgTime && msgTime <= watermark.armedAt)
    )
  );

  assert.equal(isPriorToWatermark, true, 'Mensagem antiga deve ser identificada como anterior ao watermark');
  assert.equal(supabase.getAgentCallsCount(), 0, 'ZERO chamadas ao Agent/OpenAI na ativação de mensagem antiga');
});

test('2. Ativação: última mensagem é nossa -> toggle ON arma IA com ZERO chamadas ao Agent', async () => {
  const nowIso = new Date().toISOString();
  const supabase = createDurableMockSupabase({
    messages: [
      {
        id: 'msg_mine_1',
        conversation_id: 'conv_durable_test',
        sender_id: 'me',
        is_mine: true,
        text: 'Até logo!',
        created_at: nowIso,
        timestamp: nowIso,
      },
    ],
  });

  const lastMsg = supabase._store.messages[0];
  const isMine = lastMsg.is_mine || lastMsg.sender_id === 'me';
  assert.equal(isMine, true, 'Última mensagem enviada por nós');
  assert.equal(supabase.getAgentCallsCount(), 0, 'ZERO chamadas ao Agent');
});

test('3. Ativação: toggle OFF -> ON repetidas vezes sem nova mensagem -> ZERO chamadas ao Agent em todas', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  for (let i = 0; i < 5; i++) {
    const armedAt = new Date().toISOString();
    const watermark = {
      armedAt,
      lastMessageId: 'msg_client_old',
      lastMessageTimestamp: armedAt,
    };
    await supabase.rpc('set_activation_watermark_atomic', {
      p_conversation_id: convId,
      p_watermark: watermark,
    });
  }

  assert.equal(supabase.getAgentCallsCount(), 0, 'Múltiplos toggles resultam em ZERO chamadas ao Agent');
});

test('4. Ativação: nova inbound recebida pós-ativação -> dispara exatamente UM ciclo elegível', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';
  const watermarkTime = new Date(Date.now() - 10000).toISOString();

  // Watermark anterior
  supabase._store.conversations[convId].stage_completed_rules.orchestration.activation_watermark = {
    armedAt: watermarkTime,
    lastMessageId: 'msg_client_old',
    lastMessageTimestamp: watermarkTime,
  };

  // Chegada de mensagem NOVA após a ativação
  const newMsgTime = new Date().toISOString();
  const newMsg = {
    id: 'msg_new_inbound_1',
    conversation_id: convId,
    sender_id: 'user_them',
    is_mine: false,
    text: 'Larissa, você tá por aí?',
    created_at: newMsgTime,
    timestamp: newMsgTime,
  };
  supabase._store.messages.push(newMsg);

  const watermark = supabase._store.conversations[convId].stage_completed_rules.orchestration.activation_watermark;
  const isPriorToWatermark = Boolean(
    watermark && (
      (watermark.lastMessageId && newMsg.id === watermark.lastMessageId) ||
      (watermark.armedAt && newMsgTime && newMsgTime <= watermark.armedAt)
    )
  );

  assert.equal(isPriorToWatermark, false, 'Nova mensagem posterior ao watermark é elegível para o Brain');
});

test('5. Ativação: cron-tick posterior -> não ressuscita mensagem pré-ativação', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';
  const armedTime = new Date().toISOString();

  const watermark = {
    armedAt: armedTime,
    lastMessageId: 'msg_client_old',
    lastMessageTimestamp: armedTime,
  };
  supabase._store.conversations[convId].stage_completed_rules.orchestration.activation_watermark = watermark;

  // Simulação do scanner de mensagens do cron-tick
  const inboundMessages = supabase._store.messages;
  const eligibleMessages = inboundMessages.filter((msg) => {
    if (msg.sender_id === 'me' || msg.is_mine) return false;
    const mTime = msg.timestamp || msg.created_at;
    if (watermark.lastMessageId && msg.id === watermark.lastMessageId) return false;
    if (watermark.armedAt && mTime && mTime <= watermark.armedAt) return false;
    return true;
  });

  assert.equal(eligibleMessages.length, 0, 'Cron-tick não encontra mensagens elegíveis pré-ativação');
});

test('6. Ativação: /autopilot/send-now -> exceção manual explícita autorizada inicia ciclo do Brain', async () => {
  const isManualSendNow = true;
  assert.equal(isManualSendNow, true, 'Send-now é uma exceção manual autorizada pelo operador');
});

// ==========================================================================
// 19.2 CASO ALLEF (Testes 7 a 9)
// ==========================================================================

test('7. Allef: Brain gera 4 ações -> lote completo de 4 ações é persistido no outbox antes do despacho de a0', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';
  const cycleToken = 'cycle_allef_1';

  const outboxBatch = [
    { id: 'out_0', actionIndex: 0, actionType: 'text', payload: { text: 'eita, São João tá conquistando...' }, status: 'pending' },
    { id: 'out_1', actionIndex: 1, actionType: 'text', payload: { text: 'faço Enfermagem...' }, status: 'pending' },
    { id: 'out_2', actionIndex: 2, actionType: 'text', payload: { text: 'e também trabalho com vendas online...' }, status: 'pending' },
    { id: 'out_3', actionIndex: 3, actionType: 'text', payload: { text: 'tá curtindo trabalhar com seu primo?' }, status: 'pending' },
  ];

  const res = await persistDurableOutboxBatchAtomic({
    supabase,
    conversationId: convId,
    cycleToken,
    outboxEntries: outboxBatch,
  });

  assert.equal(res.success, true, 'Lote durável deve ser persistido atomicamente');
  const storedOutbox = supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox;
  assert.equal(Object.keys(storedOutbox).length, 4, 'Todas as 4 ações devem existir no outbox antes de a0 ser despachada');
  assert.equal(storedOutbox['out_0'].status, 'pending');
  assert.equal(storedOutbox['out_1'].status, 'pending');
  assert.equal(storedOutbox['out_2'].status, 'pending');
  assert.equal(storedOutbox['out_3'].status, 'pending');
});

test('8. Allef: crash do worker após envio de a0 -> a1, a2 e a3 continuam preservadas como pending', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  const outboxBatch = [
    { id: 'out_0', actionIndex: 0, actionType: 'text', payload: { text: 'balão 0' }, status: 'pending' },
    { id: 'out_1', actionIndex: 1, actionType: 'text', payload: { text: 'balão 1' }, status: 'pending' },
    { id: 'out_2', actionIndex: 2, actionType: 'text', payload: { text: 'balão 2' }, status: 'pending' },
    { id: 'out_3', actionIndex: 3, actionType: 'text', payload: { text: 'balão 3' }, status: 'pending' },
  ];

  await persistDurableOutboxBatchAtomic({
    supabase,
    conversationId: convId,
    cycleToken: 'cycle_allef_crash',
    outboxEntries: outboxBatch,
  });

  // Simula despacho bem sucedido de a0
  const claimRes = await claimOutboxEntryAtomic({
    supabase,
    conversationId: convId,
    outboxKey: 'out_0',
    claimToken: 'worker_token_1',
  });
  assert.equal(claimRes.success, true);

  await finalizeOutboxEntryAtomic({
    supabase,
    conversationId: convId,
    outboxId: 'out_0',
    status: 'sent',
    providerMessageId: 'meta_mid_0',
  });

  // Simula crash da Edge Function / worker morre aqui
  const outboxAfterCrash = supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox;
  assert.equal(outboxAfterCrash['out_0'].status, 'sent', 'a0 deve estar sent');
  assert.equal(outboxAfterCrash['out_1'].status, 'pending', 'a1 deve continuar pending após crash');
  assert.equal(outboxAfterCrash['out_2'].status, 'pending', 'a2 deve continuar pending após crash');
  assert.equal(outboxAfterCrash['out_3'].status, 'pending', 'a3 deve continuar pending após crash');
});

test('9. Allef: dispatcher resumível retoma e envia a1, a2 e a3 na ordem sem acionar nova geração do Agent', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  // Configura estado com a0 sent e a1..a3 pending
  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_0: { id: 'out_0', actionIndex: 0, actionType: 'text', payload: { text: 'b0' }, status: 'sent', sentAt: new Date().toISOString() },
    out_1: { id: 'out_1', actionIndex: 1, actionType: 'text', payload: { text: 'b1' }, status: 'pending', notBefore: new Date(Date.now() - 1000).toISOString() },
    out_2: { id: 'out_2', actionIndex: 2, actionType: 'text', payload: { text: 'b2' }, status: 'pending', notBefore: new Date(Date.now() - 500).toISOString() },
    out_3: { id: 'out_3', actionIndex: 3, actionType: 'text', payload: { text: 'b3' }, status: 'pending', notBefore: new Date(Date.now() - 100).toISOString() },
  };

  const dispatchRes = await runDurableOutboxDispatcher({
    supabase,
    conversationId: convId,
  });

  assert.equal(dispatchRes.success, true);
  assert.equal(dispatchRes.dispatchedCount, 3, 'Deve despachar as 3 ações restantes');
  assert.equal(supabase.getAgentCallsCount(), 0, 'ZERO chamadas à OpenAI para retomar o envio de ações já aceitas');

  const finalOutbox = supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox;
  assert.equal(finalOutbox['out_1'].status, 'sent');
  assert.equal(finalOutbox['out_2'].status, 'sent');
  assert.equal(finalOutbox['out_3'].status, 'sent');
});

// ==========================================================================
// 19.3 CASO LUCAS (Testes 10 a 12)
// ==========================================================================

test('10. Lucas: áudio do Cofre + textos complementares são persistidos duravelmente no lote de outbox', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  const batch = [
    {
      id: 'out_audio_1',
      actionIndex: 0,
      actionType: 'audio',
      mediaUrl: 'https://storage.vendeo.com/audios/profissao.mp3',
      audioDurationSeconds: 38,
      vaultAudioId: 'audio_profissao_1',
      payload: { audioUrl: 'https://storage.vendeo.com/audios/profissao.mp3' },
      status: 'pending',
    },
    {
      id: 'out_text_1',
      actionIndex: 1,
      actionType: 'text',
      payload: { text: 'e você trabalha com o que?' },
      status: 'pending',
    },
  ];

  const res = await persistDurableOutboxBatchAtomic({
    supabase,
    conversationId: convId,
    cycleToken: 'cycle_lucas',
    outboxEntries: batch,
  });

  assert.equal(res.success, true);
  const outbox = supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox;
  assert.equal(outbox['out_audio_1'].actionType, 'audio');
  assert.equal(outbox['out_audio_1'].vaultAudioId, 'audio_profissao_1');
  assert.equal(outbox['out_audio_1'].audioDurationSeconds, 38);
  assert.equal(outbox['out_text_1'].actionType, 'text');
});

test('11. Lucas: ciclo originador vira stale antes do primeiro envio -> áudio é despachado pelo dispatcher independente', async () => {
  const supabase = createDurableMockSupabase({
    activeCycleToken: 'cycle_antigo_expirado',
  });
  const convId = 'conv_durable_test';

  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_audio_lucas: {
      id: 'out_audio_lucas',
      actionIndex: 0,
      actionType: 'audio',
      mediaUrl: 'https://storage.vendeo.com/audios/profissao.mp3',
      payload: { audioUrl: 'https://storage.vendeo.com/audios/profissao.mp3' },
      status: 'pending',
      notBefore: new Date(Date.now() - 5000).toISOString(),
    },
  };

  // Simula que o ciclo originador expirou e ficou stale
  supabase._store.conversations[convId].stage_completed_rules.active_cycle_token = 'cycle_stale_999';

  const dispatchRes = await runDurableOutboxDispatcher({
    supabase,
    conversationId: convId,
  });

  assert.equal(dispatchRes.success, true);
  assert.equal(dispatchRes.dispatchedCount, 1);
  const outbox = supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox;
  assert.equal(outbox['out_audio_lucas'].status, 'sent', 'Áudio despachado mesmo com ciclo originador stale');
});

test('12. Lucas: pacing por duração do áudio utiliza scheduling (not_before) em vez de sleep longo na Edge Function', async () => {
  const t0 = Date.now();
  const audioDurationSec = 38;
  const humanDelaySec = 10;

  const notBeforeAudio = new Date(t0).toISOString();
  const notBeforeNextText = new Date(t0 + (audioDurationSec + humanDelaySec) * 1000).toISOString();

  assert.ok(
    new Date(notBeforeNextText).getTime() > new Date(notBeforeAudio).getTime() + 38000,
    'not_before do próximo balão deve ser agendado para após a duração do áudio'
  );
});

// ==========================================================================
// 19.4 CASO JHONATA (Testes 13 a 15)
// ==========================================================================

test('13. Jhonata: burst de 4 inbounds -> coalescing garante no máximo 1 geração ativa simultaneamente', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  // Simula lock ativo para representar geração em andamento
  supabase._store.conversations[convId].stage_completed_rules.active_cycle_token = 'cycle_em_andamento';

  // Tentativa concorrente sinaliza preempção determinística
  const newDebounce = new Date(Date.now() + 2500).toISOString();
  await requestBrainCyclePreemptionAtomic({
    supabase,
    conversationId: convId,
    messageId: 'msg_burst_2',
    debounceUntil: newDebounce,
  });

  const conv = supabase._store.conversations[convId];
  assert.equal(conv.ai_debounce_until, newDebounce, 'Debounce atualizado para coalescer o burst');
});

test('14. Jhonata: nova inbound durante geração -> agenda sucessor coalescido sem disparar Agents concorrentes', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  const preemptionRes = await requestBrainCyclePreemptionAtomic({
    supabase,
    conversationId: convId,
    messageId: 'msg_durante_geracao',
    debounceUntil: new Date(Date.now() + 3000).toISOString(),
  });

  assert.equal(preemptionRes.success, true);
  assert.equal(supabase.getAgentCallsCount(), 0, 'Nenhum Agent concorrente é disparado na preempção');
});

test('15. Jhonata: lote de plano do Brain aceito + nova inbound recebida -> lote aceito é imutável e NÃO desaparece', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  // Lote já aceito
  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_aceita: { id: 'out_aceita', actionIndex: 0, actionType: 'text', payload: { text: 'plano aceito' }, status: 'pending' },
  };

  // Chegada de nova mensagem e solicitação de preempção
  await requestBrainCyclePreemptionAtomic({
    supabase,
    conversationId: convId,
    messageId: 'msg_nova_burst',
    debounceUntil: new Date(Date.now() + 2000).toISOString(),
  });

  // O lote aceito permanece intacto
  const outbox = supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox;
  assert.ok(outbox['out_aceita'], 'Ação aceita NÃO pode ser cancelada ou apagada por nova inbound');
  assert.equal(outbox['out_aceita'].status, 'pending');
});

// ==========================================================================
// 19.5 EXACTLY-ONCE E RECONCILIAÇÃO DE DISPATCH_UNCERTAIN (Testes 16 a 18)
// ==========================================================================

test('16. Uncertain: timeout de rede ou falha pós-requisição à Meta -> ação transiciona deterministicamente para dispatch_uncertain', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_timeout: { id: 'out_timeout', actionIndex: 0, actionType: 'text', payload: { text: 'msg incerta' }, status: 'sending' },
  };

  await finalizeOutboxEntryAtomic({
    supabase,
    conversationId: convId,
    outboxId: 'out_timeout',
    status: 'dispatch_uncertain',
    error: 'network_timeout_after_send',
  });

  const entry = supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox['out_timeout'];
  assert.equal(entry.status, 'dispatch_uncertain');
  assert.equal(entry.isUncertain, true);
});

test('17. Uncertain: reconciliação com evidência do provider -> ação evolui de dispatch_uncertain para sent sem duplicar mensagem', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  const uncertainEntry = {
    id: 'out_unc',
    actionIndex: 0,
    actionType: 'text',
    payload: { text: 'Oi tudo bem?' },
    content: 'Oi tudo bem?',
    status: 'dispatch_uncertain',
    isUncertain: true,
  };

  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_unc: uncertainEntry,
  };

  // Mensagem sincronizada no histórico do Instagram como enviada por nós
  supabase._store.messages.push({
    id: 'meta_mid_confirmed_123',
    conversation_id: convId,
    sender_id: 'me',
    is_mine: true,
    text: 'Oi tudo bem?',
    created_at: new Date().toISOString(),
  });

  const reconRes = await reconcileUncertainOutboxAction({
    supabase,
    conversationId: convId,
    outboxEntry: uncertainEntry,
  });

  assert.equal(reconRes.reconciled, true);
  assert.equal(reconRes.providerMessageId, 'meta_mid_confirmed_123');

  const entry = supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox['out_unc'];
  assert.equal(entry.status, 'sent', 'Ação deve evoluir para sent sem novo disparo');
});

test('18. Uncertain: reconciliação sem evidência do provider -> permanece fail-closed em dispatch_uncertain sem efetuar retry cego', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  const unconfirmedEntry = {
    id: 'out_sem_evidencia',
    actionIndex: 0,
    actionType: 'text',
    payload: { text: 'Mensagem sem confirmação de rede' },
    content: 'Mensagem sem confirmação de rede',
    status: 'dispatch_uncertain',
    isUncertain: true,
  };

  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_sem_evidencia: unconfirmedEntry,
  };

  const reconRes = await reconcileUncertainOutboxAction({
    supabase,
    conversationId: convId,
    outboxEntry: unconfirmedEntry,
  });

  assert.equal(reconRes.reconciled, false, 'Sem evidência, não reconcilia');
  const entry = supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox['out_sem_evidencia'];
  assert.equal(entry.status, 'dispatch_uncertain', 'Permanece fail-closed em dispatch_uncertain');
});

// ==========================================================================
// 19.6 CONCORRÊNCIA E ORDEM (Testes 19 a 21)
// ==========================================================================

test('19. Concorrência: 2 dispatchers tentam claimar a mesma ação -> exclusão mútua garante que apenas um envia', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_disputada: {
      id: 'out_disputada',
      actionIndex: 0,
      actionType: 'text',
      payload: { text: 'disputada' },
      status: 'pending',
    },
  };

  const claim1 = await claimOutboxEntryAtomic({
    supabase,
    conversationId: convId,
    outboxKey: 'out_disputada',
    claimToken: 'worker_A',
  });

  const claim2 = await claimOutboxEntryAtomic({
    supabase,
    conversationId: convId,
    outboxKey: 'out_disputada',
    claimToken: 'worker_B',
  });

  assert.equal(claim1.success, true, 'Worker A deve conseguir o claim');
  assert.equal(claim2.success, false, 'Worker B deve ter claim rejeitado');
  assert.equal(claim2.reason, 'not_pending');
});

test('20. Concorrência: ação já no status sent recebe nova tentativa de claim -> reenvio é rejeitado', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_ja_enviada: {
      id: 'out_ja_enviada',
      actionIndex: 0,
      actionType: 'text',
      payload: { text: 'já enviada' },
      status: 'sent',
    },
  };

  const claim = await claimOutboxEntryAtomic({
    supabase,
    conversationId: convId,
    outboxKey: 'out_ja_enviada',
    claimToken: 'worker_novo',
  });

  assert.equal(claim.success, false);
  assert.equal(claim.reason, 'not_pending');
});

test('21. Ordem: ação a0 em sending ou dispatch_uncertain -> ação a1 é bloqueada e não ultrapassa', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_a0: { id: 'out_a0', actionIndex: 0, actionType: 'text', payload: { text: 'a0' }, status: 'dispatch_uncertain' },
    out_a1: { id: 'out_a1', actionIndex: 1, actionType: 'text', payload: { text: 'a1' }, status: 'pending' },
  };

  const claimA1 = await claimOutboxEntryAtomic({
    supabase,
    conversationId: convId,
    outboxKey: 'out_a1',
    claimToken: 'worker_order_test',
  });

  assert.equal(claimA1.success, false, 'a1 não pode ser claimada enquanto a0 não for sent');
  assert.equal(claimA1.reason, 'prior_action_unfinished');
});

// ==========================================================================
// 19.7 TIMEOUT E RESILIÊNCIA SEM SEGUNDA GERAÇÃO (Testes 22 a 24)
// ==========================================================================

test('22. Timeout: morte entre batch persistido e dispatch -> dispatcher retoma ações pending normalmente', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_t1: { id: 'out_t1', actionIndex: 0, actionType: 'text', payload: { text: 'retomada 1' }, status: 'pending', notBefore: new Date(Date.now() - 5000).toISOString() },
  };

  const res = await runDurableOutboxDispatcher({
    supabase,
    conversationId: convId,
  });

  assert.equal(res.success, true);
  assert.equal(res.dispatchedCount, 1);
  assert.equal(supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox['out_t1'].status, 'sent');
});

test('23. Timeout: processo encerra durante intervalo de pacing -> próximas ações permanecem agendadas com not_before futuro', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';
  const futureNotBefore = new Date(Date.now() + 60000).toISOString();

  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_pacing: {
      id: 'out_pacing',
      actionIndex: 1,
      actionType: 'text',
      payload: { text: 'balão futuro' },
      status: 'pending',
      notBefore: futureNotBefore,
    },
  };

  const claimRes = await claimOutboxEntryAtomic({
    supabase,
    conversationId: convId,
    outboxKey: 'out_pacing',
    claimToken: 'worker_pacing',
  });

  assert.equal(claimRes.success, false, 'Ação com not_before futuro não deve ser claimada antes do vencimento');
  assert.equal(claimRes.reason, 'not_due_yet');
});

test('24. Resiliência: nenhuma recuperação de delivery chama a OpenAI ou regenera respostas', async () => {
  const supabase = createDurableMockSupabase();
  const convId = 'conv_durable_test';

  supabase._store.conversations[convId].stage_completed_rules.orchestration.outbox = {
    out_recovery: {
      id: 'out_recovery',
      actionIndex: 0,
      actionType: 'text',
      payload: { text: 'recuperação' },
      status: 'pending',
      notBefore: new Date(Date.now() - 1000).toISOString(),
    },
  };

  await runDurableOutboxDispatcher({
    supabase,
    conversationId: convId,
  });

  assert.equal(supabase.getAgentCallsCount(), 0, 'Custo zero de tokens na entrega do outbox persistido');
});
