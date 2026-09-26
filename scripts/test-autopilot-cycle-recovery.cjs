const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

function loadSafety() {
  const source = fs.readFileSync(path.join(__dirname, '../supabase/functions/api/autopilot_cycle_safety.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(code, { module, exports: module.exports, console, Date }, { filename: 'autopilot_cycle_safety.ts' });
  return module.exports;
}

test('contrato real: relevantMemoryContext string não sofre .filter', () => {
  assert.throws(() => ('FATOS: conhecidos' || ['fallback']).filter(Boolean), /filter is not a function/);
  const { resolveMissionMemoryContext } = loadSafety();
  assert.equal(resolveMissionMemoryContext('FATOS: conhecidos', ['fallback']), 'FATOS: conhecidos');
  assert.equal(resolveMissionMemoryContext(undefined, ['FATOS', '', 'MARCOS']), 'FATOS\n\nMARCOS');
  assert.throws(() => resolveMissionMemoryContext({ text: 'inválido' }, ['fallback']), /invalid_array_contract: field=missionPackage.relevantMemoryContext actual_type=object/);
  const orchestrator = fs.readFileSync(path.join(__dirname, '../supabase/functions/api/brain_orchestrator.ts'), 'utf8');
  assert.match(orchestrator, /relevantMemoryContext: resolveMissionMemoryContext\(brainPlan\.missionPackage\?\.relevantMemoryContext/);
  assert.doesNotMatch(orchestrator, /relevantMemoryContext: \(brainPlan\.missionPackage\?\.relevantMemoryContext \|\| \[/);
});

test('evidência de outbox sent/sending/incerta bloqueia reprocessamento automático', () => {
  const { classifyCycleOutboxEvidence } = loadSafety();
  const cycleId = 'cycle_A';
  assert.equal(classifyCycleOutboxEvidence({}, cycleId).possibleSend, false);
  for (const status of ['sending', 'sent', 'dispatch_uncertain']) {
    const result = classifyCycleOutboxEvidence({ key: { cycleId, status } }, cycleId);
    assert.equal(result.possibleSend, true, status);
  }
  assert.equal(classifyCycleOutboxEvidence({ key: { cycleId, status: 'pending' } }, cycleId).possibleSend, false);
  assert.equal(classifyCycleOutboxEvidence({ key: { cycleId: 'cycle_B', status: 'sent' } }, cycleId).possibleSend, false);
  assert.equal(classifyCycleOutboxEvidence({ key: { cycleId, status: 'pending', providerMessageId: 'meta_1' } }, cycleId).possibleSend, true);
});

test('resultado atrasado perde autoridade antes de criar outbox/despachar', async () => {
  const { checkCycleAuthority } = loadSafety();
  const supabase = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { stage_completed_rules: { active_cycle_token: 'cycle_B' } }, error: null }) }) }) }),
  };
  assert.equal(await checkCycleAuthority(supabase, 'conv_1', 'cycle_A'), false);
  assert.equal(await checkCycleAuthority(supabase, 'conv_1', 'cycle_B'), true);
  const orchestrator = fs.readFileSync(path.join(__dirname, '../supabase/functions/api/brain_orchestrator.ts'), 'utf8');
  assert.match(orchestrator, /late_agent_result_discarded/);
  assert.match(orchestrator, /if \(!\(await checkCycleAuthority\(supabase, conversationId, correlationId\)\)\)/);
  assert.match(orchestrator, /if \(claimToken && !\(await checkCycleAuthority\(supabase, outboxEntry\.conversationId, claimToken\)\)\)/);
});

test('TTL de ciclo cobre espera local do Agent e não equivale a 25s', () => {
  const { ACTIVE_CYCLE_TTL_SECONDS, AGENT_LOCAL_WAIT_MS } = loadSafety();
  assert.ok(ACTIVE_CYCLE_TTL_SECONDS * 1000 > AGENT_LOCAL_WAIT_MS);
  assert.ok(ACTIVE_CYCLE_TTL_SECONDS >= 300);
});

test('migração mantém recuperação e CAS atômicos no PostgreSQL', () => {
  const migrations = fs.readdirSync(path.join(__dirname, '../supabase/migrations'));
  const file = migrations.find((name) => name.endsWith('_recover_stale_autopilot_cycles.sql'));
  assert.ok(file, 'migração de recovery ausente');
  const sql = fs.readFileSync(path.join(__dirname, '../supabase/migrations', file), 'utf8');
  assert.match(sql, /FOR UPDATE/);
  assert.match(sql, /dispatch_uncertain/);
  assert.match(sql, /active_cycle_at/);
  assert.match(sql, /activeClaimedMessageIds/);
  assert.match(sql, /previousCycleToken/);
});
