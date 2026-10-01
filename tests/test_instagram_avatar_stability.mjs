import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("profile worker persists Meta avatars into stable Vendeo storage", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/instagram_profile_queue.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /instagram_avatars/);
  assert.match(source, /\.from\("vendeo_vault"\)/);
  assert.match(source, /upsert: true/);
  assert.match(source, /getPublicUrl\(objectPath\)/);
  assert.match(source, /instagram_avatar_download_failed/);
  assert.match(source, /Migra primeiro a URL de CDN já conhecida/);
  assert.match(source, /persistInstagramAvatar\([\s\S]*currentAvatar/);
});

test("Meta CDN avatar is not treated as permanently resolved", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/instagram_profile_queue.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /isStableAvatarUrl\(currentAvatar\)/);
  assert.match(source, /avatarNeedsMigration/);
  assert.doesNotMatch(
    source,
    /Boolean\(currentConversation\.avatar\)[\s\S]{0,120}currentConversation\.avatar !== "\/images\/default-avatar\.svg";/,
  );
});

test("failed avatar render queues a profile refresh only for Meta CDN URLs", () => {
  const source = fs.readFileSync(
    new URL("../src/presentation/components/chat/InstagramDirect.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /avatarRefreshRequests/);
  assert.match(source, /cdninstagram\.com/);
  assert.match(source, /fbcdn\.net/);
  assert.match(source, /searchParams\.get\("oe"\)/);
  assert.match(source, /Number\.parseInt\(expiryHex, 16\)/);
  assert.match(source, /!expiredMetaAvatar/);
  assert.match(source, /\/instagram\/profile\/refresh/);
  assert.match(source, /conversationId/);
});

test("profile refresh endpoint is origin-limited and reuses the durable profile queue", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/index.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /path === "\/instagram\/profile\/refresh"/);
  assert.match(source, /brainOperatorAllowedOrigin\(req\)/);
  assert.match(source, /enqueue_instagram_profile_job/);
  assert.match(source, /processInstagramProfileQueue/);
  assert.match(source, /limit: 4/);
});

test("scheduler awaits profile enrichment instead of abandoning background work", () => {
  const source = fs.readFileSync(
    new URL("../supabase/functions/api/index.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /p_lane: "instagram_profile_enrichment", p_min_interval_seconds: 15/);
  assert.match(source, /const profileResult = await processInstagramProfileQueue\(/);
  assert.doesNotMatch(source, /const profilePromise = processInstagramProfileQueue\(/);
});
