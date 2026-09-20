import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Carrega o orquestrador para testar as funções canônicas de leitura persona_get_fact e persona_search
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

const orch = loadOrchestrator();
const rawFacts = JSON.parse(fs.readFileSync('data/larissa-persona-memory.json', 'utf8'));

async function performAudit() {
  console.log('===============================================================');
  console.log('AUDITORIA READ-ONLY DA PERSONA MEMORY — LARISSA');
  console.log('===============================================================\n');

  // 1. Total e distribuição de source_type
  const total = rawFacts.length;
  const bySourceType = {};
  for (const f of rawFacts) {
    const st = f.source_type || 'unspecified';
    bySourceType[st] = (bySourceType[st] || 0) + 1;
  }

  console.log('--- 1. CONTAGEM POR SOURCE_TYPE ---');
  console.log(`Total de fatos: ${total}`);
  for (const [st, count] of Object.entries(bySourceType)) {
    console.log(`- ${st}: ${count} (${((count / total) * 100).toFixed(1)}%)`);
  }

  // 2. Exportação higienizada (sem dados sensíveis)
  const sanitizedExport = rawFacts.map(f => ({
    key: f.key,
    category: f.category,
    value: f.value,
    source_type: f.source_type,
    confidence: f.confidence,
    aliases: f.aliases || [],
    valid_from: f.valid_from || null,
    valid_until: f.valid_until || null,
  }));

  const exportPath = path.resolve('data/persona-memory-export-clean.json');
  fs.writeFileSync(exportPath, JSON.stringify(sanitizedExport, null, 2), 'utf8');
  console.log(`\nExportação segura salva em: ${exportPath} (${sanitizedExport.length} registros)`);

  // 3. Verificação de chaves duplicadas / equivalências semânticas
  console.log('\n--- 2. ANÁLISE DE DUPLICIDADES E SINÔNIMOS SEMÂNTICOS ---');
  const keyMap = new Map();
  const aliasToKeys = new Map();

  for (const f of rawFacts) {
    const k = f.key;
    if (keyMap.has(k)) {
      console.log(`[ALERTA: CHAVE EXATA DUPLICADA] ${k}`);
    } else {
      keyMap.set(k, f);
    }

    if (Array.isArray(f.aliases)) {
      for (const al of f.aliases) {
        const normAl = al.toLowerCase().trim();
        if (!aliasToKeys.has(normAl)) aliasToKeys.set(normAl, []);
        aliasToKeys.get(normAl).push(f.key);
      }
    }
  }

  // Aliases apontando para múltiplas chaves
  const overlappingAliases = [];
  for (const [al, keys] of aliasToKeys.entries()) {
    if (keys.length > 1) {
      overlappingAliases.push({ alias: al, keys });
    }
  }
  console.log(`Total de aliases com sobreposição: ${overlappingAliases.length}`);
  for (const item of overlappingAliases.slice(0, 10)) {
    console.log(`  - Alias "${item.alias}" compartilhado por: ${item.keys.join(', ')}`);
  }

  // Chaves com nomes parecidos (ex: age, identity.age, personal.age)
  console.log('\nChaves semanticamente correlatas identificadas:');
  const findRelatedKeys = (pattern) => rawFacts.filter(f => f.key.toLowerCase().includes(pattern)).map(f => ({ key: f.key, value: f.value, source: f.source_type }));
  
  const ageKeys = findRelatedKeys('age');
  console.log('- Idade:', ageKeys);

  const foodKeys = findRelatedKeys('food');
  console.log('- Comida:', foodKeys);

  const cityKeys = findRelatedKeys('city');
  console.log('- Cidade:', cityKeys);

  const drinkKeys = findRelatedKeys('drink');
  console.log('- Bebida:', drinkKeys);

  // 4. Análise dos 18 temas críticos
  console.log('\n--- 3. ANÁLISE DOS 18 TEMAS CRÍTICOS ---');
  const topics = [
    { name: 'bebida alcoólica', terms: ['alcohol', 'alcoholic', 'bebida', 'bebe', 'cerveja', 'vinho'] },
    { name: 'vinho', terms: ['wine', 'vinho'] },
    { name: 'cerveja', terms: ['beer', 'cerveja'] },
    { name: 'Tribo da Periferia', terms: ['tribo'] },
    { name: 'filmes de tubarão', terms: ['tubarao', 'shark'] },
    { name: 'café', terms: ['coffee', 'cafe'] },
    { name: 'alimentação durante o almoço', terms: ['lunch', 'almoco', 'refeicao', 'liquido'] },
    { name: 'cidade', terms: ['city', 'cidade', 'sao joao'] },
    { name: 'bairro', terms: ['neighborhood', 'bairro', 'matosinhos'] },
    { name: 'curso', terms: ['course', 'curso', 'enfermagem'] },
    { name: 'período da faculdade', terms: ['period', 'periodo', 'semestre'] },
    { name: 'formatura', terms: ['graduation', 'formatura', 'formar'] },
    { name: 'estágio', terms: ['internship', 'estagio', 'hospital'] },
    { name: 'trabalho com vendas', terms: ['sales', 'vendas', 'trabalho', 'job'] },
    { name: 'músicas', terms: ['music', 'musica', 'sertanejo', 'cantora'] },
    { name: 'filmes', terms: ['movie', 'filme', 'cinema', 'terror'] },
    { name: 'relacionamento', terms: ['relationship', 'namoro', 'casamento', 'casar'] },
    { name: 'filhos', terms: ['children', 'filhos'] },
    { name: 'religião', terms: ['religion', 'religiao', 'deus', 'igreja', 'catolica'] },
  ];

  const topicFindings = {};
  for (const top of topics) {
    const matches = rawFacts.filter(f => {
      const k = f.key.toLowerCase();
      const v = String(f.value).toLowerCase();
      const aliases = (f.aliases || []).join(' ').toLowerCase();
      return top.terms.some(t => k.includes(t) || aliases.includes(t));
    });
    topicFindings[top.name] = matches.map(m => ({ key: m.key, value: m.value, source_type: m.source_type, valid_from: m.valid_from, valid_until: m.valid_until }));
    console.log(`* ${top.name} (${matches.length} fatos mapeados):`);
    for (const m of matches) {
      console.log(`    [${m.source_type}] ${m.key} = ${JSON.stringify(m.value)}`);
    }
  }

  // 5. Verificação de fatos generated vs canonical
  console.log('\n--- 4. CLASSIFICAÇÃO GENERATED VS CANONICAL ---');
  const canonicalGeneratedDoubt = rawFacts.filter(f => {
    // Fatos canônicos devem ter origem no dossiê real
    // generated são fatos inventados ou inferidos para preencher lacunas
    return f.source_type === 'canonical' && (f.category === 'generated' || f.key.startsWith('generated.'));
  });
  console.log(`Fatos canônicos com categoria generated: ${canonicalGeneratedDoubt.length}`);

  // 6. Verificação de fatos temporais e vigência
  console.log('\n--- 5. ANÁLISE DE FATOS TEMPORAIS E VIGÊNCIA ---');
  const temporalFacts = rawFacts.filter(f => f.source_type === 'temporal' || f.valid_from || f.valid_until);
  console.log(`Total de fatos com vigência/temporal: ${temporalFacts.length}`);
  for (const tf of temporalFacts) {
    console.log(`  - [${tf.source_type}] ${tf.key} = ${JSON.stringify(tf.value)} | de ${tf.valid_from || 'indefinido'} até ${tf.valid_until || 'indefinido'}`);
  }

  // 7. Testes de Leitura com Orquestrador
  console.log('\n--- 6. EXECUÇÃO DOS SMOKE TESTS DE LEITURA (READ-ONLY) ---');
  const testsToRun = [
    { type: 'get', key: 'identity.age' },
    { type: 'get', key: 'education.current_period' },
    { type: 'get', key: 'address.city' },
    { type: 'get', key: 'music.likes_tribo_da_periferia' },
    { type: 'get', key: 'movies.shark_movies_preference' },
    { type: 'search', query: 'o que ela gosta de comer' },
    { type: 'search', query: 'o que ela gosta de fazer no tempo livre' },
    { type: 'search', query: 'perrengue da faculdade' },
  ];

  for (const t of testsToRun) {
    if (t.type === 'get') {
      const res = await orch.resolvePersonaFact(t.key, { cachedFacts: rawFacts });
      console.log(`persona_get_fact("${t.key}") -> found: ${res.found} | value: ${JSON.stringify(res.value)} | source: ${res.source_type} | key_resolvida: ${res.key}`);
    } else {
      const res = await orch.searchPersonaMemory({ query: t.query, limit: 3, cachedFacts: rawFacts });
      console.log(`persona_search("${t.query}") -> encontrados: ${res.length}`);
      for (const r of res) {
        console.log(`   [score=${r.score.toFixed(1)}] ${r.key} = ${JSON.stringify(r.value)}`);
      }
    }
  }

  // Grava relatório estruturado JSON
  const auditReport = {
    timestamp: new Date().toISOString(),
    totalFacts: total,
    bySourceType,
    temporalFactsCount: temporalFacts.length,
    overlappingAliasesCount: overlappingAliases.length,
    topicFindings,
  };
  fs.writeFileSync('data/persona-memory-audit-summary.json', JSON.stringify(auditReport, null, 2), 'utf8');
}

performAudit().catch(console.error);
