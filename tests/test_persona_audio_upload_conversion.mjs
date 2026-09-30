import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("persona audio upload normalizes file before sending it to storage", () => {
  const source = fs.readFileSync(
    new URL("../src/presentation/components/vault/PersonaAudioVaultModal.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /ensureInstagramCompatibleAudio/);
  assert.match(source, /const compatibleFile = await ensureInstagramCompatibleAudio\(file\)/);
  assert.match(source, /formData\.append\("file", compatibleFile, compatibleFile\.name\)/);

  const normalizeIndex = source.indexOf("ensureInstagramCompatibleAudio(file)");
  const appendIndex = source.indexOf('formData.append("file", compatibleFile, compatibleFile.name)');
  assert.ok(normalizeIndex >= 0);
  assert.ok(appendIndex > normalizeIndex);
});

test("persona audio upload no longer appends the raw file directly", () => {
  const source = fs.readFileSync(
    new URL("../src/presentation/components/vault/PersonaAudioVaultModal.tsx", import.meta.url),
    "utf8",
  );

  const uploadSection = source.slice(
    source.indexOf("// 2. Normaliza o áudio antes do upload"),
    source.indexOf("const upRes = await fetch", source.indexOf("// 2. Normaliza o áudio antes do upload")),
  );
  assert.doesNotMatch(uploadSection, /formData\.append\("file", file\)/);
});
