// ============================================================================
// DEPRECATED WRITER — Redireciona para o sincronizador canônico único
// Mantido apenas para retrocompatibilidade de comandos/scripts legados.
// NENHUMA instrução independente deve ser declarada aqui.
// ============================================================================

import { spawnSync } from 'child_process';
import path from 'path';

console.warn('[DEPRECATION NOTICE] scripts/update_openai_agent_memory.mjs foi depreciado.');
console.warn('Utilizando o sincronizador oficial canônico: scripts/sync_openai_agent.mjs\n');

const canonicalScript = path.resolve(import.meta.dirname, 'sync_openai_agent.mjs');
const result = spawnSync('node', [canonicalScript], { stdio: 'inherit' });
process.exit(result.status || 0);
