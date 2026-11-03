import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluateSyntheticReciprocity} from '../scripts/evaluate-reciprocity-synthetic.mjs';

test('runner produz nove resultados revisáveis sem aprovar a qualidade automaticamente',async()=>{
  const checkpoints=[];
  const provider={async preflight(){},async evaluate(messages){return {result:{summary:'Saída simulada somente para testar o runner.'},usage:{inputTokens:100,outputTokens:20},durationMs:5,estimatedCostUsd:0.00002};}};
  const report=await evaluateSyntheticReciprocity(provider,{model:'gpt-6-luna',reasoning:'low'},async partial=>checkpoints.push(partial.cases.length));
  assert.deepEqual(checkpoints,[1,2,3,4,5,6,7,8,9]);
  assert.equal(report.cases.length,9);
  assert.equal(report.qualityStatus,'aguarda_revisao_humana');
  assert.equal(report.humanReview.decision,null);
  assert.equal(report.totals.inputTokens,900);
  assert.equal(report.totals.outputTokens,180);
  assert.equal(report.totals.completed,9);
  assert.equal(report.totals.casesWithoutCostEstimate,0);
  assert.ok(report.cases.every(item=>item.humanReview.approved===null));
  assert.ok(report.cases.every(item=>item.reviewQuestions.length>0));
});

test('falha de um caso não descarta consumo registrado nem interrompe os outros casos',async()=>{
  let caseIndex=0;
  const provider={async preflight(){},async evaluate(){caseIndex++;if(caseIndex===2)throw Object.assign(new Error('Resposta incompleta.'),{usage:{inputTokens:400,outputTokens:80},durationMs:7,estimatedCostUsd:0.00008});return {result:{summary:'Saída simulada.'},usage:{inputTokens:100,outputTokens:20},durationMs:5,estimatedCostUsd:0.00002};}};
  const report=await evaluateSyntheticReciprocity(provider,{model:'gpt-6-luna',reasoning:'low'});
  assert.equal(report.cases[1].status,'failed');
  assert.equal(report.cases[1].usage.inputTokens,400);
  assert.equal(report.cases[8].status,'completed');
  assert.equal(report.totals.failed,1);
  assert.equal(report.totals.inputTokens,1200);
  assert.equal(report.qualityStatus,'aguarda_revisao_humana');
});
