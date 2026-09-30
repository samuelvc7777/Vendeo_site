import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeInstagramReactionEmoji,
  parseInstagramReactionEvent,
} from "../supabase/functions/api/instagram_reactions.ts";

test("parses a real Instagram react payload", () => {
  const parsed = parseInstagramReactionEvent({
    sender: { id: "ig-user-1" },
    recipient: { id: "ig-business-1" },
    timestamp: 1790796000000,
    reaction: {
      mid: "mid.123",
      reaction: "love",
      emoji: "❤️",
      action: "react",
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.messageId, "mid.123");
  assert.equal(parsed.senderId, "ig-user-1");
  assert.equal(parsed.action, "react");
  assert.equal(parsed.emoji, "❤️");
});

test("maps named reactions when Meta omits emoji", () => {
  assert.equal(normalizeInstagramReactionEmoji("love"), "❤️");
  assert.equal(normalizeInstagramReactionEmoji("like"), "👍");
  assert.equal(normalizeInstagramReactionEmoji("haha"), "😂");
});

test("accepts webhook timestamps in seconds as well as milliseconds", () => {
  const parsed = parseInstagramReactionEvent({
    sender: { id: "ig-user-1" },
    timestamp: 1790796000,
    reaction: {
      mid: "mid.seconds",
      action: "react",
      emoji: "🔥",
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.reactedAt, new Date(1790796000 * 1000).toISOString());
});

test("unreact clears the reaction without requiring emoji", () => {
  const parsed = parseInstagramReactionEvent({
    sender: { id: "ig-user-1" },
    timestamp: 1790796000000,
    reaction: {
      mid: "mid.123",
      action: "unreact",
    },
  });

  assert.ok(parsed);
  assert.equal(parsed.action, "unreact");
  assert.equal(parsed.emoji, null);
});

test("ignores malformed or unsupported reaction events", () => {
  assert.equal(parseInstagramReactionEvent({ reaction: { action: "react", emoji: "❤️" } }), null);
  assert.equal(parseInstagramReactionEvent({
    sender: { id: "ig-user-1" },
    reaction: { mid: "mid.123", action: "unknown", emoji: "❤️" },
  }), null);
});
