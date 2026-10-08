import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../supabase/functions/api/brain_orchestrator.ts', import.meta.url), 'utf8');
const semanticStates = [...source.matchAll(/semanticState:\s*(\{\s*cycleToken: correlationId,[\s\S]*?lastDecision: decision,\s*\})/g)].map(match => match[1]);

// Executa os payloads reais de commit usados pelo orquestrador. O CAS do banco
// deve comparar a etapa observada depois da inicialização do cronograma.
for (const [index, payload] of semanticStates.entries()) {
  test(`commit ${index}: primeira ativação usa a etapa inicializada antes do claim`, () => {
    const actual = vm.runInNewContext(`(${payload})`, {
      convRow: { current_stage_id: null },
      claimedConversation: { current_stage_id: 'stage_1_conexao' },
      correlationId: 'cycle-1', decision: { checkpoint: '' },
      stageProgression: { updatedCompletedGoals: [], updatedObjectiveProgress: {}, nextPhase: 'stage_1_conexao', nextStageId: 'stage_1_conexao' },
    });
    assert.equal(actual.expectedCurrentStageId, 'stage_1_conexao', 'o banco rejeitaria o commit por semantic commit lost current stage CAS');
  });
  test(`commit ${index}: preserva snapshot para detectar mudança concorrente`, () => {
    const actual = vm.runInNewContext(`(${payload})`, {
      convRow: { current_stage_id: 'stage_old' },
      claimedConversation: { current_stage_id: 'stage_claimed' },
      correlationId: 'cycle-1', decision: { checkpoint: '' },
      stageProgression: { updatedCompletedGoals: [], updatedObjectiveProgress: {}, nextPhase: 'stage_next', nextStageId: 'stage_next' },
    });
    assert.equal(actual.expectedCurrentStageId, 'stage_claimed');
    assert.notEqual(actual.expectedCurrentStageId, actual.currentStageId);
  });
}
assert.equal(semanticStates.length, 2, 'cobre os commits de resposta e de espera/resolução manual');
