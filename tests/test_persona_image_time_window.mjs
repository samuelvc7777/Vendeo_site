import assert from "assert";

function isCurrentTimeAllowedForPersonaImage(startTime, endTime, testTimeStr) {
  const start = startTime ? startTime.trim() : "";
  const end = endTime ? endTime.trim() : "";
  if (!start || !end) return true;

  const currentTime = testTimeStr; // "HH:MM"

  if (start <= end) {
    return currentTime >= start && currentTime <= end;
  } else {
    return currentTime >= start || currentTime <= end;
  }
}

console.log("Iniciando testes da janela de horário das fotos do cofre...");

// Cenário 1: Sem restrição (24h)
assert.strictEqual(isCurrentTimeAllowedForPersonaImage("", "", "14:00"), true);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(null, null, "03:00"), true);

// Cenário 2: Faixa padrão (12:00 as 17:00 - Tarde / Estágio)
const s1 = "12:00";
const e1 = "17:00";
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s1, e1, "11:59"), false);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s1, e1, "12:00"), true);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s1, e1, "14:30"), true);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s1, e1, "17:00"), true);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s1, e1, "17:01"), false);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s1, e1, "21:00"), false);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s1, e1, "08:00"), false);

// Cenário 3: Faixa noturna que vira a meia-noite (22:00 as 06:00 - Pijama / Cama / Madrugada)
const s2 = "22:00";
const e2 = "06:00";
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s2, e2, "21:59"), false);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s2, e2, "22:00"), true);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s2, e2, "23:45"), true);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s2, e2, "00:00"), true);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s2, e2, "03:15"), true);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s2, e2, "06:00"), true);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s2, e2, "06:01"), false);
assert.strictEqual(isCurrentTimeAllowedForPersonaImage(s2, e2, "14:00"), false);

console.log("Todos os testes passaram com sucesso absoluto!");
