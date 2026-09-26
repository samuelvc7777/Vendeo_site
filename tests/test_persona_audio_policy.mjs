import test from "node:test";
import assert from "node:assert/strict";
import {
  inferReciprocalPersonaAudioIntent,
  isPersonaAudioInstructionMatch,
} from "../supabase/functions/api/persona_audio_policy.ts";

const now = new Date("2026-09-25T18:34:00.000Z");

test("reciprocal e vc inherits the recent hobbies question and searches the audio vault", () => {
  const intent = inferReciprocalPersonaAudioIntent({
    inboundTexts: ["eu gosto de jogar bola amor", "e vc?"],
    recentMessages: [
      {
        sender: "larissa",
        text: "quando sobra um tempinho, vc gosta de fazer oq?",
        createdAt: "2026-09-25T18:32:57.000Z",
      },
    ],
    now,
  });

  assert.deepEqual(intent, {
    topic: "hobbies",
    searchQuery: "hobbies gostos o que gosto de fazer tempo livre passeios viagens filmes",
  });
  assert.equal(isPersonaAudioInstructionMatch("hobbies", "Qua do perguntar oque gosto de fazer, meus gostos"), true);
});

test("reciprocal replies do not reuse stale topics or select mismatched audio", () => {
  const intent = inferReciprocalPersonaAudioIntent({
    inboundTexts: ["e você?"],
    recentMessages: [
      {
        sender: "larissa",
        text: "quando sobra um tempinho, vc gosta de fazer oq?",
        createdAt: "2026-09-20T18:32:57.000Z",
      },
    ],
    now,
  });

  assert.equal(intent, null);
  assert.equal(isPersonaAudioInstructionMatch("hobbies", "Usar quando perguntar sobre minha profissão e curso"), false);
});
