#!/usr/bin/env node
/**
 * scripts/import-larissa-persona-memory.mjs
 * 
 * Script de Importação Idempotente da Persona Memory Completa da Larissa no Supabase.
 * Fonte Oficial: data/larissa-persona-memory.json (.agents/LARISSA_PERSONA.md)
 * 
 * Regras Estritas:
 * - Importa idempotentemente para AMBOS os projetos Supabase:
 *   1) wsdualhvopidgqcumonr (App Principal)
 *   2) pdhtgzwfbqygflzbwdkt (Edge Functions / Worker)
 * - Saneamento Canônico Estrito:
 *   - Odeia café preto (toma leite com pão).
 *   - Comida favorita: bife com batata frita (prato favorito: strogonoff).
 *   - NÃO bebe álcool, vinho ou cerveja.
 *   - Bebe líquido durante a refeição (água/suco/refri).
 *   - Música: Simone Mendes, Henrique & Juliano, Marília Mendonça, Jorge & Mateus (NÃO Tribo da Periferia).
 *   - Filmes de tubarão: NÃO é preferência (shark_movies_preference: false).
 * - Priorização de validade: canonical > temporal > generated.
 * - Idempotente via onConflict: (persona_id, key).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// Carrega variáveis de ambiente (.env.local / .env)
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

export function loadPersonaDataset(customPath = null) {
  const filePath = customPath || path.resolve('data/larissa-persona-memory.json');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Arquivo de dataset não encontrado em: ${filePath}. Execute primeiro: node scripts/build-full-persona-dataset.mjs`);
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

// Configuração dos dois projetos Supabase de produção
export const SUPABASE_PROJECTS = [
  {
    id: 'wsdualhvopidgqcumonr',
    name: 'App Principal (Vendeo Social)',
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wsdualhvopidgqcumonr.supabase.co',
    serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzZHVhbGh2b3BpZGdxY3Vtb25yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODkwODM4OSwiZXhwIjoyMTA0NDg0Mzg5fQ.ebpH41NJdrNgRbgch4ciTxTS6SppRRoJzSPoyEmN2MU',
  },
  {
    id: 'pdhtgzwfbqygflzbwdkt',
    name: 'Edge Functions / Worker (vendeo_site)',
    url: 'https://pdhtgzwfbqygflzbwdkt.supabase.co',
    serviceKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBkaHRnendmYnF5Z2ZsemJ3ZGt0Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODkwMjE5NiwiZXhwIjoyMTA0NDc4MTk2fQ.uq18UHD5WbOPIV7zEFh0EvLI9sO0I74WpBo-0SEuPa8',
  }
];

export async function importPersonaMemoryToProject(project, dataset, batchSize = 50) {
  console.log(`\n==================================================`);
  console.log(`[UPSERT] Iniciando importação em: ${project.name} (${project.id})`);
  console.log(`[URL] ${project.url}`);
  console.log(`==================================================`);

  const supabase = createClient(project.url, project.serviceKey, {
    auth: { persistSession: false },
  });

  const nowIso = new Date().toISOString();
  let totalProcessed = 0;

  for (let i = 0; i < dataset.length; i += batchSize) {
    const chunk = dataset.slice(i, i + batchSize);
    const payloads = chunk.map((fact) => ({
      persona_id: fact.persona_id || 'larissa',
      category: fact.category,
      key: fact.key,
      value: fact.value,
      source_type: fact.source_type,
      confidence: typeof fact.confidence === 'number' ? fact.confidence : 1.0,
      aliases: Array.isArray(fact.aliases) ? fact.aliases : [],
      valid_from: fact.valid_from || null,
      valid_until: fact.valid_until || null,
      updated_at: nowIso,
    }));

    const { data, error } = await supabase
      .from('persona_memory')
      .upsert(payloads, { onConflict: 'persona_id,key' })
      .select('key');

    if (error) {
      console.error(`[ERRO] Falha no chunk ${i} a ${i + chunk.length - 1} em ${project.id}:`, error.message);
      throw error;
    }

    totalProcessed += (data?.length || chunk.length);
    process.stdout.write(`- Processados: ${totalProcessed}/${dataset.length} fatos...\r`);
  }

  console.log(`\n[SUCESSO] ${totalProcessed} fatos upserted com sucesso em ${project.id}.`);

  // Validação rápida de contagem
  const { count, error: countErr } = await supabase
    .from('persona_memory')
    .select('*', { count: 'exact', head: true })
    .eq('persona_id', 'larissa');

  if (!countErr) {
    console.log(`[TOTAL NO BANCO] Projeto ${project.id} agora contém ${count} fatos da Larissa.`);
  }

  return { projectId: project.id, totalProcessed, totalInDb: count };
}

export async function importPersonaMemory(options = {}) {
  const dataset = loadPersonaDataset(options.datasetPath);
  console.log(`[DATASET] Carregados ${dataset.length} fatos para importação.`);

  const canonicalCount = dataset.filter((d) => d.source_type === 'canonical').length;
  const temporalCount = dataset.filter((d) => d.source_type === 'temporal').length;
  const generatedCount = dataset.filter((d) => d.source_type === 'generated').length;
  console.log(`- Canonical: ${canonicalCount}`);
  console.log(`- Temporal: ${temporalCount}`);
  console.log(`- Generated: ${generatedCount}`);

  const results = [];
  const targetProjects = options.targetProject
    ? SUPABASE_PROJECTS.filter((p) => p.id === options.targetProject)
    : SUPABASE_PROJECTS;

  for (const proj of targetProjects) {
    const res = await importPersonaMemoryToProject(proj, dataset, options.batchSize || 50);
    results.push(res);
  }

  return {
    datasetTotal: dataset.length,
    canonicalCount,
    temporalCount,
    generatedCount,
    results,
  };
}

// Execução direta via CLI
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))) {
  importPersonaMemory()
    .then((summary) => {
      console.log('\n==================================================');
      console.log('RESUMO FINAL DA IMPORTAÇÃO EM AMBOS OS PROJETOS');
      console.log('==================================================');
      console.log(`Dataset Total: ${summary.datasetTotal}`);
      console.log(`Canonical: ${summary.canonicalCount} | Temporal: ${summary.temporalCount} | Generated: ${summary.generatedCount}`);
      for (const r of summary.results) {
        console.log(`- ${r.projectId}: ${r.totalProcessed} upserted, total no banco: ${r.totalInDb}`);
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n[FATAL] Erro ao executar importação:', err);
      process.exit(1);
    });
}
