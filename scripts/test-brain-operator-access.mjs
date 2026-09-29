import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import {
  BRAIN_OPERATOR_COOKIE,
  BRAIN_OPERATOR_SESSION_SECONDS,
  brainOperatorCookieOptions,
  createBrainOperatorSession,
  isBrainOperatorAuthConfigured,
  isSameOriginRequest,
  verifyBrainOperatorPassword,
  verifyBrainOperatorSession,
} from "../src/infrastructure/security/brainOperatorSession.ts";

const savedPassword = process.env.BRAIN_OPERATOR_PASSWORD;
const savedSessionSecret = process.env.BRAIN_OPERATOR_SESSION_SECRET;
process.env.BRAIN_OPERATOR_PASSWORD = "operador-local-seguro-123";
process.env.BRAIN_OPERATOR_SESSION_SECRET = "test-only-session-secret-with-at-least-32-bytes";

test("sessão global de operador assina e expira no servidor", () => {
  const now = Date.UTC(2026, 8, 26, 12, 0, 0);
  assert.equal(isBrainOperatorAuthConfigured(), true);
  assert.equal(verifyBrainOperatorPassword("operador-local-seguro-123"), true);
  assert.equal(verifyBrainOperatorPassword("senha-errada"), false);
  const token = createBrainOperatorSession(now);
  assert.equal(verifyBrainOperatorSession(token, now), true);
  assert.equal(verifyBrainOperatorSession(`${token}x`, now), false);
  assert.equal(verifyBrainOperatorSession(token, now + BRAIN_OPERATOR_SESSION_SECONDS * 1000 + 1), false);
  assert.equal(verifyBrainOperatorSession(null, now), false);
});

test("cookie não pode ser lido pelo browser e mutações exigem mesma origem", () => {
  assert.equal(BRAIN_OPERATOR_COOKIE, "vendeo_brain_operator");
  assert.equal(brainOperatorCookieOptions().httpOnly, true);
  assert.equal(brainOperatorCookieOptions().sameSite, "strict");
  assert.equal(brainOperatorCookieOptions().path, "/api/operator");
  assert.equal(isSameOriginRequest(new Request("https://vendeo.local/api/operator", { headers: { origin: "https://vendeo.local" } })), true);
  assert.equal(isSameOriginRequest(new Request("https://vendeo.local/api/operator", { headers: { origin: "https://attacker.local" } })), false);
  assert.equal(isSameOriginRequest(new Request("https://vendeo.local/api/operator")), false);
});

test("operações do operador usam sessão autenticada e segredo somente no servidor", async () => {
  const bff = await readFile(new URL("../src/app/api/operator/brain/[operation]/route.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../src/presentation/components/chat/AutoPilotActivityIndicator.tsx", import.meta.url), "utf8");
  const operatorApi = await readFile(new URL("../src/infrastructure/http/brainOperatorApi.ts", import.meta.url), "utf8");
  assert.match(bff, /verifyBrainOperatorSession/);
  assert.match(bff, /isSameOriginRequest/);
  assert.match(bff, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(bff, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(ui, /brainOperatorFetch\([`"](?:\$\{[^}]+\})?\/operator\/brain\/events/);
  assert.match(ui, /brainOperatorFetch\([`"]\/operator\/brain\/manual-resolution/);
  assert.match(ui, /brainOperatorFetch\([`"]\/operator\/brain\/retry-failed-action/);
  assert.match(operatorApi, /Authorization.*Bearer/);
  assert.doesNotMatch(ui, /\/rest\/v1\/rpc\/patch_chat_progress_atomic/);
  assert.doesNotMatch(ui, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(ui, /functions\/v1\/api\/autopilot\/(?:brain-events|manual-resolution|retry-failed-action)/);
});

test("eventos são inseridos e nenhum fluxo de aplicação atualiza ou apaga a timeline", async () => {
  const apiDir = new URL("../supabase/functions/api/", import.meta.url);
  const files = ["autopilot_state.ts", "brain_orchestrator.ts", "index.ts"];
  const source = (await Promise.all(files.map((file) => readFile(new URL(file, apiDir), "utf8")))).join("\n");
  const migration = await readFile(new URL("../supabase/migrations/20260926212713_brain_decision_outbox_sessions.sql", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\.from\(["']brain_turn_events["']\)\s*\.\s*(?:update|delete)\s*\(/i);
  assert.match(migration, /GRANT SELECT, INSERT ON public\.brain_turn_events TO service_role/);
  assert.doesNotMatch(migration, /GRANT [^;]*(?:UPDATE|DELETE) ON public\.brain_turn_events/i);
});

test("detector semântico do piloto foi removido e não participa do runtime", async () => {
  const runtime = await readFile(new URL("../supabase/functions/api/brain_orchestrator.ts", import.meta.url), "utf8");
  const brain = await readFile(new URL("../supabase/functions/api/openai_brain.ts", import.meta.url), "utf8");
  const legacyUrl = new URL("../supabase/functions/api/legacy_pilot_objective_detector.ts", import.meta.url);
  assert.doesNotMatch(runtime, /detectSpontaneousObjectiveCompletions|legacy_pilot_objective_detector/);
  assert.doesNotMatch(brain, /detectSpontaneousObjectiveCompletions|legacy_pilot_objective_detector/);
  await assert.rejects(access(legacyUrl));
});

test.after(() => {
  if (savedPassword === undefined) delete process.env.BRAIN_OPERATOR_PASSWORD;
  else process.env.BRAIN_OPERATOR_PASSWORD = savedPassword;
  if (savedSessionSecret === undefined) delete process.env.BRAIN_OPERATOR_SESSION_SECRET;
  else process.env.BRAIN_OPERATOR_SESSION_SECRET = savedSessionSecret;
});
