import test from "node:test";
import assert from "node:assert/strict";
import { formatPersonaMemoryProfileForPrompt } from "../supabase/functions/api/persona_memory.ts";

test("snapshot do perfil inclui fatos canônicos e temporais vigentes e rotula hipóteses", () => {
  const snapshot = formatPersonaMemoryProfileForPrompt([
    {
      persona_id: "larissa",
      category: "formação",
      key: "course",
      value: "Enfermagem",
      source_type: "canonical",
      confidence: 1,
      aliases: [],
      valid_from: null,
      valid_until: null,
    },
    {
      persona_id: "larissa",
      category: "rotina",
      key: "current_schedule",
      value: "Estágio neste mês",
      source_type: "temporal",
      confidence: 1,
      aliases: [],
      valid_from: "2026-01-01T00:00:00.000Z",
      valid_until: "2026-12-31T23:59:59.000Z",
    },
    {
      persona_id: "larissa",
      category: "hipótese",
      key: "possible_preference",
      value: "Talvez goste de trilha",
      source_type: "generated",
      confidence: 0.4,
      aliases: [],
      valid_from: null,
      valid_until: null,
    },
    {
      persona_id: "larissa",
      category: "antigo",
      key: "expired_fact",
      value: "não incluir",
      source_type: "temporal",
      confidence: 1,
      aliases: [],
      valid_from: null,
      valid_until: "2025-12-31T23:59:59.000Z",
    },
  ], new Date("2026-09-25T15:00:00.000Z"));

  assert.ok(snapshot.includes('"chave":"course","valor":"Enfermagem"'));
  assert.ok(snapshot.includes('"chave":"current_schedule","valor":"Estágio neste mês"'));
  assert.ok(snapshot.includes('"chave":"possible_preference","valor":"Talvez goste de trilha"'));
  assert.ok(snapshot.includes("hipóteses não verificadas"));
  assert.ok(snapshot.includes("cofre_audio_search"));
  assert.ok(!snapshot.includes("expired_fact"));
});

test("snapshot vazio não é apresentado como perfil completo", () => {
  assert.equal(formatPersonaMemoryProfileForPrompt([]), "");
});
