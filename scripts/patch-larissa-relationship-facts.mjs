import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

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

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://wsdualhvopidgqcumonr.supabase.co';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!serviceKey) {
  console.error("SUPABASE_SERVICE_ROLE_KEY não encontrada!");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

const canonicalFacts = [
  {
    persona_id: 'larissa',
    category: 'relacionamentos',
    key: 'relationships.relationship_status',
    value: 'solteira',
    source_type: 'canonical',
    confidence: 1.0,
    aliases: ['estado civil', 'namora', 'namorando', 'solteira', 'tem namorado', 'namora bb'],
  },
  {
    persona_id: 'larissa',
    category: 'relacionamentos',
    key: 'relationships.currently_dating',
    value: false,
    source_type: 'canonical',
    confidence: 1.0,
    aliases: ['namora', 'está namorando', 'tem namorado', 'namora bb', 'tá namorando'],
  },
  {
    persona_id: 'relacionamentos',
    category: 'relacionamentos',
    key: 'relationships.has_children',
    value: false,
    source_type: 'canonical',
    confidence: 1.0,
    aliases: ['tem filhos', 'tem filho', 'filhos', 'mãe', 'é mãe', 'filho'],
  },
  {
    persona_id: 'larissa',
    category: 'casamento',
    key: 'relationships.ever_married',
    value: false,
    source_type: 'canonical',
    confidence: 1.0,
    aliases: ['já casou', 'casada', 'foi casada', 'já foi casada', 'casamento', 'é casada'],
  },
  {
    persona_id: 'larissa',
    category: 'relacionamentos',
    key: 'relationships.past_relationships_count',
    value: 1,
    source_type: 'canonical',
    confidence: 1.0,
    aliases: ['quantas vezes namorou', 'já namorou', 'quantos namorados', 'experiência amorosa'],
  },
  {
    persona_id: 'larissa',
    category: 'relacionamentos',
    key: 'relationships.past_relationship_experience',
    value: 'só namorou uma vez na vida e a experiência não foi boa',
    source_type: 'canonical',
    confidence: 1.0,
    aliases: ['como foi o namoro', 'namoro passado', 'experiência de namoro', 'ex namorado', 'já namorou quantas vezes'],
  },
  {
    persona_id: 'larissa',
    category: 'relacionamentos',
    key: 'relationships.dating_attitude',
    value: '100% solteira, cautelosa após experiência amorosa passada ruim, focada na faculdade de enfermagem, estágio hospitalar, vendas e família',
    source_type: 'canonical',
    confidence: 1.0,
    aliases: ['procura namorado', 'quer namorar', 'postura sobre namoro', 'tá solteira'],
  },
  {
    persona_id: 'larissa',
    category: 'familia',
    key: 'family.has_children',
    value: false,
    source_type: 'canonical',
    confidence: 1.0,
    aliases: ['tem filhos', 'tem filho', 'crianças', 'filhos'],
  },
];

async function main() {
  console.log("=== INSERINDO / ATUALIZANDO FATOS CANÔNICOS DE RELACIONAMENTO DA LARISSA ===");
  for (const fact of canonicalFacts) {
    const { data: existing, error: selectErr } = await supabase
      .from('persona_memory')
      .select('id, key, value')
      .eq('key', fact.key)
      .maybeSingle();

    if (selectErr) {
      console.error(`Erro ao verificar chave ${fact.key}:`, selectErr);
      continue;
    }

    if (existing) {
      const { error: updateErr } = await supabase
        .from('persona_memory')
        .update({
          value: fact.value,
          category: fact.category,
          source_type: fact.source_type,
          confidence: fact.confidence,
          aliases: fact.aliases,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      if (updateErr) {
        console.error(`Erro ao atualizar ${fact.key}:`, updateErr);
      } else {
        console.log(`[ATUALIZADO] ${fact.key} -> ${JSON.stringify(fact.value)}`);
      }
    } else {
      const { error: insertErr } = await supabase
        .from('persona_memory')
        .insert({
          persona_id: fact.persona_id,
          category: fact.category,
          key: fact.key,
          value: fact.value,
          source_type: fact.source_type,
          confidence: fact.confidence,
          aliases: fact.aliases,
        });

      if (insertErr) {
        console.error(`Erro ao inserir ${fact.key}:`, insertErr);
      } else {
        console.log(`[INSERIDO] ${fact.key} -> ${JSON.stringify(fact.value)}`);
      }
    }
  }

  // Atualizar também o arquivo local data/larissa-persona-memory.json
  const localFile = path.resolve('data/larissa-persona-memory.json');
  if (fs.existsSync(localFile)) {
    try {
      const localData = JSON.parse(fs.readFileSync(localFile, 'utf8'));
      for (const fact of canonicalFacts) {
        const idx = localData.findIndex((f) => f.key === fact.key);
        if (idx >= 0) {
          localData[idx] = { ...localData[idx], ...fact };
        } else {
          localData.push(fact);
        }
      }
      fs.writeFileSync(localFile, JSON.stringify(localData, null, 2), 'utf8');
      console.log(`[ARQUIVO LOCAL] Atualizado: ${localFile}`);
    } catch (e) {
      console.error("Erro ao atualizar data/larissa-persona-memory.json:", e);
    }
  }

  console.log("=== FINALIZADO COM SUCESSO ===");
}

main();
