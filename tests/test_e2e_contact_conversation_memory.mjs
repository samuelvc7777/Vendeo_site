import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

// Carregar variáveis de ambiente
const envPath = path.resolve(import.meta.dirname, '../.env.local');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, l) => {
  const [k, ...v] = l.trim().split('=');
  if (k && v.length) acc[k] = v.join('=').replace(/^["']|["']$/g, '').trim();
  return acc;
}, {});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const MCP_TOKEN = env.VENDEO_BRAIN_MCP_TOKEN;
const OBSIDIAN_TOKEN = env.OBSIDIAN_SYNC_TOKEN;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
const MCP_ENDPOINT = `${SUPABASE_URL}/functions/v1/vendeo-brain-mcp`;
const API_ENDPOINT = `${SUPABASE_URL}/functions/v1/api`;

const TEST_CONV_ID = `test_e2e_memory_${Date.now()}`;
let activeScopeId = null;

function computeFingerprint(input) {
  return crypto.createHash('sha256').update(String(input).trim().toLowerCase()).digest('hex').slice(0, 32);
}

async function callMcpTool(name, args) {
  const res = await fetch(MCP_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${MCP_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: {
        name,
        arguments: args,
      },
    }),
  });
  return res.json();
}

async function runTests() {
  console.log('===============================================================');
  console.log(' BATERIA DE TESTES E2E: CONTACT + CONVERSATION MEMORY (00–05) ');
  console.log(` Conversa de Teste: ${TEST_CONV_ID}`);
  console.log('===============================================================\n');

  let passed = 0;
  let failed = 0;

  // -------------------------------------------------------------
  // TESTE 1: Geração e Registro do Capability Scope Efêmero
  // -------------------------------------------------------------
  try {
    console.log('[TESTE 1] Criando Capability Scope em agent_memory_scopes...');
    activeScopeId = `scope_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const expiresAt = new Date(Date.now() + 180 * 1000).toISOString();

    const { error: scopeErr } = await supabase.from('agent_memory_scopes').insert({
      scope_id: activeScopeId,
      conversation_id: TEST_CONV_ID,
      cycle_id: `cycle_test_${Date.now()}`,
      agent_id: 'test_orchestrator',
      expires_at: expiresAt,
    });

    if (scopeErr) throw scopeErr;

    const { data: fetchedScope, error: fetchErr } = await supabase
      .from('agent_memory_scopes')
      .select('*')
      .eq('scope_id', activeScopeId)
      .single();

    if (fetchErr || !fetchedScope) throw new Error('Scope não encontrado após insert');
    if (fetchedScope.conversation_id !== TEST_CONV_ID) throw new Error('Scope gravado com conversa errada');

    console.log(`✅ TESTE 1 PASSOU: Scope criado com sucesso: ${activeScopeId}`);
    passed++;
  } catch (err) {
    console.error('❌ TESTE 1 FALHOU:', err.message);
    failed++;
  }

  // -------------------------------------------------------------
  // TESTE 2: MCP Fail-Closed com Scope Inválido / Aleatório
  // -------------------------------------------------------------
  try {
    console.log('\n[TESTE 2] Chamando contact_memory_search com scope INVÁLIDO...');
    const fakeScopeRes = await callMcpTool('contact_memory_search', {
      scope: 'scope_totalmente_falso_999',
      query: 'onde mora',
    });

    const isError = fakeScopeRes.error || (fakeScopeRes.result?.isError === true);
    const text = fakeScopeRes.result?.content?.[0]?.text || fakeScopeRes.error?.message || '';

    if (isError && (text.includes('FAIL_CLOSED') || text.includes('inválido') || text.includes('revogado') || text.includes('expirado'))) {
      console.log(`✅ TESTE 2 PASSOU: MCP rejeitou com FAIL-CLOSED: "${text.slice(0, 80)}..."`);
      passed++;
    } else {
      throw new Error(`MCP permitiu acesso indevido ou não retornou fail-closed: ${JSON.stringify(fakeScopeRes)}`);
    }
  } catch (err) {
    console.error('❌ TESTE 2 FALHOU:', err.message);
    failed++;
  }

  // -------------------------------------------------------------
  // TESTE 3: MCP Aceita Scope Válido e Ativo
  // -------------------------------------------------------------
  try {
    console.log('\n[TESTE 3] Chamando contact_memory_search com scope VÁLIDO...');
    const validRes = await callMcpTool('contact_memory_search', {
      scope: activeScopeId,
      query: 'cidade',
    });

    const isError = validRes.error || (validRes.result?.isError === true);
    if (isError) throw new Error(`MCP retornou erro para scope válido: ${JSON.stringify(validRes)}`);

    const rawData = JSON.parse(validRes.result?.content?.[0]?.text || '{}');
    if (rawData.status !== 'success' || !Array.isArray(rawData.facts)) {
      throw new Error(`Estrutura de resposta inválida: ${JSON.stringify(rawData)}`);
    }

    console.log(`✅ TESTE 3 PASSOU: Scope validado pelo MCP, retorno: ${rawData.facts.length} fatos.`);
    passed++;
  } catch (err) {
    console.error('❌ TESTE 3 FALHOU:', err.message);
    failed++;
  }

  // -------------------------------------------------------------
  // TESTE 4: Escrita Determinística & Idempotência por Fingerprint
  // -------------------------------------------------------------
  try {
    console.log('\n[TESTE 4] Testando persistência de fatos e idempotência...');
    const fact1Fp = computeFingerprint(`self:city:belo horizonte`);
    const quote1Fp = computeFingerprint(`sou apaixonado por café especial`);

    const factData = {
      conversation_id: TEST_CONV_ID,
      entity: 'self',
      field: 'city',
      value: 'Belo Horizonte',
      normalized_value: 'belo horizonte',
      temporal_status: 'durable',
      source_message_ids: ['msg_test_001'],
      source_actor: 'pretendente',
      confidence: 1.0,
      importance: 0.8,
      fact_fingerprint: fact1Fp,
    };

    const quoteData = {
      conversation_id: TEST_CONV_ID,
      speaker: 'pretendente',
      quote_text: 'Sou apaixonado por café especial',
      normalized_quote: 'sou apaixonado por café especial',
      context_or_reason: 'conversa sobre café da manhã',
      source_message_id: 'msg_test_001',
      importance: 0.7,
      quote_fingerprint: quote1Fp,
    };

    // Primeiro Insert
    const { error: insFactErr } = await supabase.from('contact_memory_facts').upsert(factData, {
      onConflict: 'conversation_id,fact_fingerprint',
      ignoreDuplicates: true,
    });
    if (insFactErr) throw insFactErr;

    const { error: insQuoteErr } = await supabase.from('contact_memory_quotes').upsert(quoteData, {
      onConflict: 'conversation_id,quote_fingerprint',
      ignoreDuplicates: true,
    });
    if (insQuoteErr) throw insQuoteErr;

    // Segundo Insert (idêntico) para testar IDEMPOTÊNCIA
    const { error: idempFactErr } = await supabase.from('contact_memory_facts').upsert(factData, {
      onConflict: 'conversation_id,fact_fingerprint',
      ignoreDuplicates: true,
    });
    if (idempFactErr) throw idempFactErr;

    const { error: idempQuoteErr } = await supabase.from('contact_memory_quotes').upsert(quoteData, {
      onConflict: 'conversation_id,quote_fingerprint',
      ignoreDuplicates: true,
    });
    if (idempQuoteErr) throw idempQuoteErr;

    // Verifica que existe EXATAMENTE 1 fato e 1 quote
    const { count: factCount } = await supabase
      .from('contact_memory_facts')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', TEST_CONV_ID);

    const { count: quoteCount } = await supabase
      .from('contact_memory_quotes')
      .select('*', { count: 'exact', head: true })
      .eq('conversation_id', TEST_CONV_ID);

    if (factCount !== 1 || quoteCount !== 1) {
      throw new Error(`Falha de idempotência: esperado 1 fato e 1 quote, obtido ${factCount} fatos e ${quoteCount} quotes.`);
    }

    console.log(`✅ TESTE 4 PASSOU: Gravação determinística com idempotência 100% comprovada.`);
    passed++;
  } catch (err) {
    console.error('❌ TESTE 4 FALHOU:', err.message);
    failed++;
  }

  // -------------------------------------------------------------
  // TESTE 5: Lógica de Supersede (Atualização de Fato Durável)
  // -------------------------------------------------------------
  try {
    console.log('\n[TESTE 5] Testando supersede de fatos com histórico seguro...');
    
    // Inserir profissão anterior
    const oldFp = computeFingerprint(`self:job:desenvolvedor pleno`);
    const { data: oldInserted, error: oldErr } = await supabase
      .from('contact_memory_facts')
      .insert({
        conversation_id: TEST_CONV_ID,
        entity: 'self',
        field: 'job',
        value: 'Desenvolvedor Pleno',
        normalized_value: 'desenvolvedor pleno',
        temporal_status: 'durable',
        source_message_ids: ['msg_test_002'],
        source_actor: 'pretendente',
        confidence: 0.9,
        importance: 0.7,
        fact_fingerprint: oldFp,
      })
      .select()
      .single();

    if (oldErr) throw oldErr;

    // Novo valor que substitui a profissão
    const newFp = computeFingerprint(`self:job:arquiteto de software`);
    const { data: newInserted, error: newErr } = await supabase
      .from('contact_memory_facts')
      .insert({
        conversation_id: TEST_CONV_ID,
        entity: 'self',
        field: 'job',
        value: 'Arquiteto de Software',
        normalized_value: 'arquiteto de software',
        temporal_status: 'durable',
        source_message_ids: ['msg_test_003'],
        source_actor: 'pretendente',
        confidence: 1.0,
        importance: 0.9,
        fact_fingerprint: newFp,
      })
      .select()
      .single();

    if (newErr) throw newErr;

    // Marca o antigo como superseded apontando para o novo
    await supabase
      .from('contact_memory_facts')
      .update({
        temporal_status: 'superseded',
        superseded_by_id: newInserted.id,
      })
      .eq('id', oldInserted.id);

    // Consulta e valida
    const { data: activeJobs } = await supabase
      .from('contact_memory_facts')
      .select('value, temporal_status, superseded_by_id')
      .eq('conversation_id', TEST_CONV_ID)
      .eq('field', 'job');

    const superseded = activeJobs.find((j) => j.temporal_status === 'superseded');
    const active = activeJobs.find((j) => j.temporal_status === 'durable');

    if (!superseded || !active) throw new Error('Não encontrou ambos os registros ativo e superseded');
    if (superseded.superseded_by_id !== newInserted.id) throw new Error('superseded_by_id incorreto');
    if (active.value !== 'Arquiteto de Software') throw new Error('Valor ativo incorreto');

    console.log(`✅ TESTE 5 PASSOU: Supersede estruturado validado (antigo apontando para ${newInserted.id.slice(0, 8)}).`);
    passed++;
  } catch (err) {
    console.error('❌ TESTE 5 FALHOU:', err.message);
    failed++;
  }

  // -------------------------------------------------------------
  // TESTE 6: Busca no MCP Retorna Apenas Fatos Ativos
  // -------------------------------------------------------------
  try {
    console.log('\n[TESTE 6] Buscando fatos via MCP com scope ativo...');
    const searchRes = await callMcpTool('contact_memory_search', {
      scope: activeScopeId,
      query: 'trabalho arquiteto profissão',
    });

    const rawData = JSON.parse(searchRes.result?.content?.[0]?.text || '{}');
    const jobs = rawData.facts?.filter((f) => f.field === 'job') || [];

    if (jobs.length !== 1) {
      throw new Error(`Esperado exatamente 1 fato ativo de job, obtido: ${jobs.length}`);
    }
    if (jobs[0].value !== 'Arquiteto de Software') {
      throw new Error(`MCP retornou fato antigo ou incorreto: ${jobs[0].value}`);
    }

    console.log(`✅ TESTE 6 PASSOU: MCP retornou apenas o fato ativo ("${jobs[0].value}") e filtrou o superseded.`);
    passed++;
  } catch (err) {
    console.error('❌ TESTE 6 FALHOU:', err.message);
    failed++;
  }

  // -------------------------------------------------------------
  // TESTE 7: Revogação de Scope & Verificação Fail-Closed Pós-Revogação
  // -------------------------------------------------------------
  try {
    console.log('\n[TESTE 7] Revogando scope e testando fail-closed imediato...');
    await supabase
      .from('agent_memory_scopes')
      .update({ revoked_at: new Date().toISOString() })
      .eq('scope_id', activeScopeId);

    const callAfterRevoke = await callMcpTool('contact_memory_search', {
      scope: activeScopeId,
      query: 'qualquer busca',
    });

    const isError = callAfterRevoke.error || (callAfterRevoke.result?.isError === true);
    const text = callAfterRevoke.result?.content?.[0]?.text || callAfterRevoke.error?.message || '';

    if (isError && (text.includes('FAIL_CLOSED') || text.includes('revogado') || text.includes('expirado'))) {
      console.log(`✅ TESTE 7 PASSOU: Scope revogado resultou em FAIL-CLOSED imediato.`);
      passed++;
    } else {
      throw new Error(`MCP aceitou scope revogado: ${JSON.stringify(callAfterRevoke)}`);
    }
  } catch (err) {
    console.error('❌ TESTE 7 FALHOU:', err.message);
    failed++;
  }

  // -------------------------------------------------------------
  // TESTE 8: Memória Episódica, Open Loops & Endpoints da API v255
  // -------------------------------------------------------------
  try {
    console.log('\n[TESTE 8] Gravando episódio de open loop e testando export da API v255...');
    
    // Inserir episódio com loop_status = 'open'
    const { error: epErr } = await supabase.from('conversation_episodic_memory').insert({
      conversation_id: TEST_CONV_ID,
      actor: 'pretendente',
      event_type: 'plan',
      memory_class: 'open_loop',
      summary: 'Pretendente prometeu enviar a foto do labrador no sábado',
      details: 'Disse que o cachorro fica engraçado com bandana',
      emotional_tone: 'alegre',
      relevance_score: 1.0,
      importance: 0.9,
      loop_status: 'open',
    });
    if (epErr) throw epErr;

    // Chamar endpoint /internal/conversation-episodes-export
    const epUrl = `${API_ENDPOINT}/internal/conversation-episodes-export?conversation_id=${encodeURIComponent(TEST_CONV_ID)}`;
    const epRes = await fetch(epUrl, {
      headers: { Authorization: `Bearer ${OBSIDIAN_TOKEN}` },
    });

    if (!epRes.ok) throw new Error(`HTTP ${epRes.status}: ${await epRes.text()}`);
    const epData = await epRes.json();

    if (!Array.isArray(epData.openLoops) || epData.openLoops.length === 0) {
      throw new Error(`openLoops vazio ou ausente na resposta da API: ${JSON.stringify(epData)}`);
    }

    const loop = epData.openLoops[0];
    if (loop.loopStatus !== 'open' || !loop.summary.includes('labrador')) {
      throw new Error(`Dados do open loop divergentes: ${JSON.stringify(loop)}`);
    }

    console.log(`✅ TESTE 8 PASSOU: API v255 retornou open loop com loopStatus: "${loop.loopStatus}".`);
    passed++;
  } catch (err) {
    console.error('❌ TESTE 8 FALHOU:', err.message);
    failed++;
  }

  // -------------------------------------------------------------
  // LIMPEZA FINAL
  // -------------------------------------------------------------
  console.log('\n[LIMPEZA] Removendo dados temporários da conversa de teste...');
  await supabase.from('contact_memory_facts').delete().eq('conversation_id', TEST_CONV_ID);
  await supabase.from('contact_memory_quotes').delete().eq('conversation_id', TEST_CONV_ID);
  await supabase.from('conversation_episodic_memory').delete().eq('conversation_id', TEST_CONV_ID);
  await supabase.from('agent_memory_scopes').delete().eq('conversation_id', TEST_CONV_ID);
  console.log('Limpeza concluída.');

  console.log('\n===============================================================');
  console.log(` RESULTADO FINAL: ${passed} PASSOU | ${failed} FALHOU (Total: ${passed + failed})`);
  console.log('===============================================================');

  if (failed > 0) process.exit(1);
}

runTests().catch((e) => {
  console.error('Erro fatal no executor de testes:', e);
  process.exit(1);
});
