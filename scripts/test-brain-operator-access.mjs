import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";

test("frontend do operador não mantém login, sessão ou bearer", async () => {
  const operatorApi = await readFile(new URL("../src/infrastructure/http/brainOperatorApi.ts", import.meta.url), "utf8");
  const operatorPage = await readFile(new URL("../src/app/operator/page.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(operatorApi, /sessionStorage|localStorage|Authorization|Bearer|password/i);
  assert.match(operatorApi, /fetch\(operatorApiUrl\(path\)/);
  assert.match(operatorPage, /router\.replace\("\/"\)/);
  assert.doesNotMatch(operatorPage, /Senha de operador|loginBrainOperator|LockKeyhole/);
});

test("Edge aceita o site público por origem e não depende dos segredos de operador", async () => {
  const auth = await readFile(new URL("../supabase/functions/api/brain_operator_auth.ts", import.meta.url), "utf8");
  const index = await readFile(new URL("../supabase/functions/api/index.ts", import.meta.url), "utf8");
  const progress = await readFile(new URL("../supabase/functions/api/operator_chat_progress.ts", import.meta.url), "utf8");

  assert.match(auth, /vendeo-e755e\.web\.app/);
  assert.doesNotMatch(auth, /BRAIN_OPERATOR_PASSWORD|BRAIN_OPERATOR_SESSION_SECRET|createBrainOperatorToken|verifyBrainOperatorToken/);
  assert.match(index, /handleOperatorChatProgress\(req, supabase, brainOperatorAllowedOrigin\(req\), corsHeaders\)/);
  assert.match(index, /authenticated:\s*true/);
  assert.doesNotMatch(index, /isBrainOperatorRequest|brainOperatorPasswordMatches|createBrainOperatorToken|verifyBrainOperatorToken/);
  assert.doesNotMatch(progress, /Sessão de operador inválida|expirada/);
});

test("operações do Brain preservam service_role apenas no servidor e permitem a origem Vendeo", async () => {
  const edge = await readFile(new URL("../supabase/functions/api/index.ts", import.meta.url), "utf8");
  const bff = await readFile(new URL("../src/app/api/operator/brain/[operation]/route.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../src/presentation/components/chat/AutoPilotActivityIndicator.tsx", import.meta.url), "utf8");

  assert.match(edge, /isPrivilegedOperationalRequest\(req, Deno\.env\.get\("SUPABASE_SERVICE_ROLE_KEY"\)\) && !brainOperatorAllowedOrigin\(req\)/);
  assert.match(bff, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(bff, /verifyBrainOperatorSession|BRAIN_OPERATOR_COOKIE|BRAIN_OPERATOR_PASSWORD|BRAIN_OPERATOR_SESSION_SECRET/);
  assert.doesNotMatch(bff, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(ui, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("migration remove tabela e RPCs exclusivos do login antigo", async () => {
  const migration = await readFile(new URL("../supabase/migrations/20261001022350_remove_brain_operator_login.sql", import.meta.url), "utf8");
  assert.match(migration, /drop function if exists public\.consume_brain_operator_login_attempt/i);
  assert.match(migration, /drop function if exists public\.clear_brain_operator_login_attempts/i);
  assert.match(migration, /drop table if exists public\.brain_operator_login_limits/i);
});

test("eventos continuam append-only", async () => {
  const apiDir = new URL("../supabase/functions/api/", import.meta.url);
  const files = ["autopilot_state.ts", "brain_orchestrator.ts", "index.ts"];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, apiDir), "utf8")))).join("\n");
  const migration = await readFile(new URL("../supabase/migrations/20260926212713_brain_decision_outbox_sessions.sql", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.from\(["']brain_turn_events["']\)\s*\.\s*(?:update|delete)\s*\(/i);
  assert.match(migration, /GRANT SELECT, INSERT ON public\.brain_turn_events TO service_role/);
  assert.doesNotMatch(migration, /GRANT [^;]*(?:UPDATE|DELETE) ON public\.brain_turn_events/i);
});

test("detector semântico legado segue removido", async () => {
  const runtime = await readFile(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
  const brain = await readFile(new URL("../supabase/functions/api/openai_brain.ts", import.meta.url), "utf8");
  const legacyUrl = new URL("../supabase/functions/api/legacy_pilot_objective_detector.ts", import.meta.url);
  assert.doesNotMatch(runtime, /detectSpontaneousObjectiveCompletions|legacy_pilot_objective_detector/);
  assert.doesNotMatch(brain, /detectSpontaneousObjectiveCompletions|legacy_pilot_objective_detector/);
  await assert.rejects(access(legacyUrl));
});
