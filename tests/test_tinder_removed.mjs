import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("integração Tinder foi removida das superfícies de runtime", () => {
  assert.equal(existsSync(join(root, "src/app/api/tinder")), false);
  assert.equal(existsSync(join(root, "src/infrastructure/tinder")), false);
  assert.equal(existsSync(join(root, "src/presentation/components/tinder")), false);
  assert.equal(existsSync(join(root, "src/domain/entities/Tinder.ts")), false);

  for (const relativePath of [
    "src/presentation/components/chat/InstagramDirect.tsx",
    "src/presentation/components/chat/ChatFilterModal.tsx",
    "src/presentation/components/config/ConfigView.tsx",
    "src/presentation/hooks/useChatRealtime.ts",
    "src/infrastructure/supabase/RealtimeBroadcaster.ts",
    "supabase/functions/api/index.ts",
  ]) {
    const source = readFileSync(join(root, relativePath), "utf8");
    assert.doesNotMatch(source, /tinder/i, relativePath);
  }
});

test("migração remove as tabelas Tinder aposentadas", () => {
  const migration = readFileSync(
    join(root, "supabase/migrations/20261001190230_remove_tinder_integration.sql"),
    "utf8"
  );

  assert.match(migration, /drop table if exists public\.tinder_messages cascade/i);
  assert.match(migration, /drop table if exists public\.tinder_conversations cascade/i);
  assert.match(migration, /drop table if exists public\.tinder_config cascade/i);
});
