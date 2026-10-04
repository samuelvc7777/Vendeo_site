import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("integração Tinder está conectada e presente nas camadas do projeto", () => {
  assert.equal(existsSync(join(root, "src/app/api/tinder/auth/route.ts")), true);
  assert.equal(existsSync(join(root, "src/app/api/tinder/status/route.ts")), true);
  assert.equal(existsSync(join(root, "src/app/api/tinder/disconnect/route.ts")), true);
  assert.equal(existsSync(join(root, "src/app/api/tinder/matches/route.ts")), true);
  assert.equal(existsSync(join(root, "src/app/api/tinder/messages/[matchId]/route.ts")), true);
  assert.equal(existsSync(join(root, "src/app/api/tinder/matches/[matchId]/restrict/route.ts")), true);
  assert.equal(existsSync(join(root, "src/infrastructure/tinder/TinderApiClient.ts")), true);
  assert.equal(existsSync(join(root, "src/presentation/components/tinder/TinderConnectModal.tsx")), true);
  assert.equal(existsSync(join(root, "src/presentation/components/tinder/TinderProfileModal.tsx")), true);
  assert.equal(existsSync(join(root, "src/domain/entities/Tinder.ts")), true);

  // Valida referências nos pontos de integração essenciais
  const integrationPoints = [
    { file: "src/presentation/components/chat/InstagramDirect.tsx", pattern: /Tinder/i },
    { file: "src/presentation/components/chat/ChatFilterModal.tsx", pattern: /isTinder/i },
    { file: "src/presentation/components/config/ConfigView.tsx", pattern: /Tinder/i },
    { file: "src/presentation/hooks/useChatRealtime.ts", pattern: /onTinderMessage/i },
    { file: "src/infrastructure/supabase/RealtimeBroadcaster.ts", pattern: /broadcastTinderMessage/i },
    { file: "supabase/functions/api/brain_orchestrator.ts", pattern: /channelRow\?\.channel === "tinder"/i },
  ];

  for (const { file, pattern } of integrationPoints) {
    const content = readFileSync(join(root, file), "utf8");
    assert.match(content, pattern, `Arquivo ${file} deve conter integração com Tinder`);
  }
});

test("migração recria e conecta as tabelas Tinder e constraints necessárias", () => {
  const migrationPath = join(root, "supabase/migrations/20261003233000_reconnect_tinder_integration.sql");
  assert.equal(existsSync(migrationPath), true);

  const migration = readFileSync(migrationPath, "utf8");
  assert.match(migration, /create table if not exists public\.tinder_config/i);
  assert.match(migration, /create table if not exists public\.tinder_conversations/i);
  assert.match(migration, /create table if not exists public\.tinder_messages/i);
  assert.match(migration, /tinder/i);
});
