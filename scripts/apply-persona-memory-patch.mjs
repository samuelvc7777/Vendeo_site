import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { createClient } from '@supabase/supabase-js';

// Carrega .env / .env.local
function loadEnv(projectRoot = process.cwd()) {
  const envFiles = ['.env.local', '.env'];
  for (const file of envFiles) {
    const fullPath = path.resolve(projectRoot, file);
    if (fs.existsSync(fullPath)) {
      try {
        const content = fs.readFileSync(fullPath, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eqIdx = trimmed.indexOf('=');
          if (eqIdx > 0) {
            const key = trimmed.slice(0, eqIdx).trim();
            let val = trimmed.slice(eqIdx + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              val = val.slice(1, -1);
            }
            if (!process.env[key]) {
              process.env[key] = val;
            }
          }
        }
      } catch {}
    }
  }
}

loadEnv();

const SUPABASE_PROJECTS = [
  {
    id: 'wsdualhvopidgqcumonr',
    name: 'App Principal (Vendeo Social)',
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wsdualhvopidgqcumonr.supabase.co',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },
  {
    id: 'pdhtgzwfbqygflzbwdkt',
    name: 'Edge Functions / Worker (vendeo_site)',
    url: 'https://pdhtgzwfbqygflzbwdkt.supabase.co',
    serviceKey: process.env.LEGACY_SUPABASE_SERVICE_ROLE_KEY || '',
  }
];

function loadOrchestrator() {
  const tsCode = fs.readFileSync('supabase/functions/api/experimental_orchestrator.ts', 'utf8');
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const mod = { exports: {} };
  vm.runInNewContext(jsCode, {
    module: mod,
    exports: mod.exports,
    require: () => ({}),
    fetch: globalThis.fetch,
    console,
    setTimeout,
    clearTimeout,
    TextDecoder,
    TextEncoder,
    Deno: { env: { get: () => '' } },
  });

  return mod.exports;
}

async function main() {
  console.log('===============================================================');
  console.log('APLICAÇÃO DO PATCH FINAL DA PERSONA MEMORY — LARISSA');
  console.log('===============================================================\n');

  // 1. Carrega dados existentes e patch
  const existingFactsPath = path.resolve('data/larissa-persona-memory.json');
  const patchPath = path.resolve('data/larissa-persona-memory-patch.json');

  const existingFacts = JSON.parse(fs.readFileSync(existingFactsPath, 'utf8'));
  const patchData = JSON.parse(fs.readFileSync(patchPath, 'utf8'));

  const countBefore = existingFacts.length;
  console.log(`[BASE INICIAL] Total existente local: ${countBefore} registros`);

  // Indexa chaves existentes
  const existingKeySet = new Set(existingFacts.map(f => f.key));

  // Validação dos registros em patch.insert
  const rawInsertList = patchData.insert || [];
  console.log(`[PATCH INSERT] Total de registros em "insert": ${rawInsertList.length}`);

  const toInsert = [];
  let ignoredCount = 0;

  for (const item of rawInsertList) {
    // Regra 2: Todos source_type="generated", NÃO transformar em canonical
    const sourceType = item.source_type;
    if (sourceType !== 'generated') {
      throw new Error(`[VIOLAÇÃO REGRA 2] Registro com source_type não-generated detectado: ${item.key} (${sourceType})`);
    }

    // Regra 3: Não alterar existentes quando a key já existir
    if (existingKeySet.has(item.key)) {
      console.log(`[IGNORADO] Chave já existente preservada sem alteração: ${item.key}`);
      ignoredCount++;
      continue;
    }

    toInsert.push({
      persona_id: 'larissa',
      category: item.category,
      key: item.key,
      value: item.value,
      source_type: 'generated',
      confidence: typeof item.confidence === 'number' ? item.confidence : 0.8,
      aliases: Array.isArray(item.aliases) ? item.aliases : [],
      valid_from: item.valid_from || null,
      valid_until: item.valid_until || null,
    });
  }

  console.log(`[FILTRAGEM] Inserções válidas novas: ${toInsert.length} | Ignorados por já existir: ${ignoredCount}`);
  const expectedFinalCount = countBefore + toInsert.length;
  console.log(`[PREVISÃO FINAL] ${countBefore} + ${toInsert.length} = ${expectedFinalCount} registros`);

  // 2. Importação no Supabase (em ambos os projetos de produção)
  const nowIso = new Date().toISOString();
  for (const proj of SUPABASE_PROJECTS) {
    console.log(`\n--- Conectando ao Supabase: ${proj.name} (${proj.id}) ---`);
    const supabase = createClient(proj.url, proj.serviceKey, { auth: { persistSession: false } });

    // Contagem antes no banco
    const { count: dbCountBefore, error: errBefore } = await supabase
      .from('persona_memory')
      .select('*', { count: 'exact', head: true })
      .eq('persona_id', 'larissa');
    if (errBefore) throw new Error(`Erro ao contar antes em ${proj.id}: ${errBefore.message}`);
    console.log(`- Contagem no banco antes: ${dbCountBefore}`);

    // Inserção em chunks de 50
    const batchSize = 50;
    let insertedInDb = 0;
    for (let i = 0; i < toInsert.length; i += batchSize) {
      const chunk = toInsert.slice(i, i + batchSize).map(f => ({
        ...f,
        updated_at: nowIso,
      }));

      const { data, error: insertErr } = await supabase
        .from('persona_memory')
        .upsert(chunk, { onConflict: 'persona_id,key', ignoreDuplicates: true })
        .select('key');

      if (insertErr) {
        throw new Error(`Erro ao inserir chunk em ${proj.id}: ${insertErr.message}`);
      }
      insertedInDb += (data?.length || chunk.length);
    }
    console.log(`- Inseridos com sucesso em ${proj.id}: ${insertedInDb}`);

    // Contagem final no banco
    const { count: dbCountAfter, error: errAfter } = await supabase
      .from('persona_memory')
      .select('*', { count: 'exact', head: true })
      .eq('persona_id', 'larissa');
    if (errAfter) throw new Error(`Erro ao contar depois em ${proj.id}: ${errAfter.message}`);
    console.log(`- Contagem final no banco: ${dbCountAfter}`);

    // Consulta de distribuição por source_type
    const { data: allRows, error: rowsErr } = await supabase
      .from('persona_memory')
      .select('source_type')
      .eq('persona_id', 'larissa');
    if (rowsErr) throw new Error(`Erro ao buscar rows em ${proj.id}: ${rowsErr.message}`);

    const dbDist = {};
    for (const r of allRows) {
      dbDist[r.source_type] = (dbDist[r.source_type] || 0) + 1;
    }
    console.log(`- Distribuição no banco ${proj.id}:`, dbDist);
  }

  // 3. Atualiza arquivos locais (larissa-persona-memory.json e export clean)
  const combinedFacts = [...existingFacts, ...toInsert];
  fs.writeFileSync(existingFactsPath, JSON.stringify(combinedFacts, null, 2), 'utf8');
  console.log(`\n[LOCAL ATUALIZADO] ${existingFactsPath} salvo com ${combinedFacts.length} registros.`);

  const cleanExportPath = path.resolve('data/persona-memory-export-clean.json');
  const cleanExport = combinedFacts.map(f => ({
    key: f.key,
    category: f.category,
    value: f.value,
    source_type: f.source_type,
    confidence: f.confidence,
    aliases: f.aliases || [],
    valid_from: f.valid_from || null,
    valid_until: f.valid_until || null,
  }));
  fs.writeFileSync(cleanExportPath, JSON.stringify(cleanExport, null, 2), 'utf8');
  console.log(`[EXPORT LIMPO ATUALIZADO] ${cleanExportPath} salvo com ${cleanExport.length} registros.`);

  // 4. Execução dos testes solicitados com o experimental_orchestrator
  console.log('\n===============================================================');
  console.log('EXECUÇÃO DOS TESTES DE RECUPERAÇÃO (persona_get_fact & persona_search)');
  console.log('===============================================================\n');

  const orch = loadOrchestrator();

  const searchQueries = [
    "qual estilo de roupa dela",
    "ela gosta de receber flores",
    "o que ela faria se ganhasse um milhão",
    "ela gosta de academia",
    "qual tipo de humor dela",
    "ela usa muito instagram",
    "qual o maior medo dela",
    "o que ela gosta de fazer numa praia",
  ];

  const searchResultsSummary = [];
  for (const q of searchQueries) {
    const res = await orch.searchPersonaMemory({
      query: q,
      limit: 3,
      cachedFacts: combinedFacts,
    });
    console.log(`\n[BUSCA] "${q}" -> ${res.length} matches:`);
    for (const r of res) {
      console.log(`   - [score=${r.score.toFixed(1)}] [${r.source_type}] ${r.key} = ${JSON.stringify(r.value)}`);
    }
    searchResultsSummary.push({ query: q, top: res[0] });
  }

  // Testes de persona_get_fact diretos em chaves do patch novo
  console.log('\n--- Testes Diretos de persona_get_fact ---');
  const directKeys = [
    "fashion.style",
    "affection.likes_flowers",
    "hypothetical.if_won_million",
    "fitness.gym_is_not_core_routine",
    "humor.style",
    "tech.uses_instagram_a_lot",
    "fears.losing_family",
    "nature.prefers_quiet_beach",
  ];

  for (const k of directKeys) {
    const factRes = await orch.resolvePersonaFact(k, { cachedFacts: combinedFacts });
    console.log(`persona_get_fact("${k}") -> found: ${factRes.found} | value: ${JSON.stringify(factRes.value)} | source: ${factRes.source_type}`);
  }

  // 5. Teste de Precedência Estrita: Confirmar que generated NUNCA vence canonical ou temporal
  console.log('\n--- Teste de Precedência Estrita (Canonical/Temporal vs Generated) ---');
  // Criamos uma coleção de teste com chave com conflito proposital
  const testConflictFacts = [
    {
      key: "test.drink_preference",
      aliases: ["preferencia de bebida"],
      value: "valor_gerado_inferior",
      source_type: "generated",
      confidence: 1.0,
      valid_from: null,
      valid_until: null,
    },
    {
      key: "test.drink_preference",
      aliases: ["preferencia de bebida"],
      value: "valor_canonico_vencedor",
      source_type: "canonical",
      confidence: 1.0,
      valid_from: null,
      valid_until: null,
    },
  ];

  const conflictRes = await orch.resolvePersonaFact("test.drink_preference", { cachedFacts: testConflictFacts });
  console.log(`[TESTE CONFLITO DIRETO] persona_get_fact("test.drink_preference") -> resolved: ${JSON.stringify(conflictRes.value)} | source: ${conflictRes.source_type}`);
  if (conflictRes.source_type !== "canonical" || conflictRes.value !== "valor_canonico_vencedor") {
    throw new Error("[FALHA NO TESTE DE PRECEDÊNCIA] Generated venceu canonical indevidamente!");
  }
  console.log('[CONFIRMAÇÃO] Canonical venceu com prioridade máxima conforme esperado.');

  // Conclui e salva sumário
  const dist = {};
  for (const f of combinedFacts) {
    dist[f.source_type] = (dist[f.source_type] || 0) + 1;
  }

  const finalSummary = {
    timestamp: new Date().toISOString(),
    countBefore,
    insertedCount: toInsert.length,
    ignoredCount,
    finalCount: combinedFacts.length,
    distribution: dist,
    searchResults: searchResultsSummary,
  };

  fs.writeFileSync('data/patch-application-summary.json', JSON.stringify(finalSummary, null, 2), 'utf8');
  console.log('\n[PATCH CONCLUÍDO COM SUCESSO]');
}

main().catch((err) => {
  console.error('\n[ERRO FATAL NA APLICAÇÃO DO PATCH]:', err);
  process.exit(1);
});
