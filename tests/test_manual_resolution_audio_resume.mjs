import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(
  new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url),
  "utf8",
);

test("manual resolution preserves audio candidates from the original stage", () => {
  assert.match(source, /if \(params\.manualResolution\?\.turnId\)/);
  assert.match(source, /\.eq\("decision_type", "manual_resolution"\)/);
  assert.match(source, /semanticState\.expectedCurrentStageId \|\|\s*semanticState\.lastDecision\?\.currentPhase/);
  assert.match(source, /manualResolutionOriginObjectiveIds = \(Array\.isArray\(originStage\?\.goals\)/);
  assert.match(source, /\.filter\(\(goal: any\) => goal && goal\.enabled !== false\)/);
  assert.match(source, /\.\.\.manualResolutionOriginObjectiveIds/);
  assert.match(source, /objectiveIds: stageObjectiveIds/);
});

test("normal turns keep using the existing stage objectives", () => {
  assert.match(
    source,
    /\.\.\.\(stageObjectivesForRouter\.goals \|\| \[\]\)[\s\S]*?\.\.\.manualResolutionOriginObjectiveIds/,
  );
});
