#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markdownPath = path.join(root, "supabase/functions/api/larissa_canonical_prompt.md");
const generatedPath = path.join(root, "supabase/functions/api/larissa_canonical_prompt.generated.ts");
const prompt = fs.readFileSync(markdownPath, "utf8").replace(/\r\n/g, "\n").trim();
const optionalManifest = JSON.parse(fs.readFileSync(path.join(root, "supabase/functions/api/larissa_optional_memory_manifest.json"), "utf8"));
const promptLines = prompt.split("\n");
const optionalMemories = optionalManifest.map((prefix, index) => {
  const matching = promptLines.filter(line => line.startsWith(prefix));
  if (matching.length !== 1) throw new Error(`Fato opcional precisa de uma origem única: ${prefix}`);
  return { id: `canonical:optional:${index + 1}`, text: matching[0].trim(), source: "canonical_prompt", revision: prompt.match(/^VENDEO_AGENT_INSTRUCTIONS_VERSION: (\S+)$/m)?.[1] || "" };
});
const removedLines = new Set(optionalMemories.map(memory => memory.text));
const essentialPrompt = promptLines.filter(line => !removedLines.has(line.trim())).join("\n");
const version = prompt.match(/^VENDEO_AGENT_INSTRUCTIONS_VERSION: (\S+)$/m)?.[1];
const questionContract = prompt.match(/\[\r?\n  \{\r?\n    "responseIndex": 1,[\s\S]*?\r?\n  \}\r?\n\]/)?.[0];
if (!questionContract) throw new Error("Contrato questionIntents não encontrado no Markdown.");
if (!version) throw new Error("O Markdown precisa declarar VENDEO_AGENT_INSTRUCTIONS_VERSION.");
const generated = [
  "/** Arquivo gerado; edite larissa_canonical_prompt.md. */",
  `export const LARISSA_CANONICAL_PROMPT_VERSION = ${JSON.stringify(version)};`,
  `export const LARISSA_CANONICAL_PROMPT = ${JSON.stringify(prompt)};`,
  `export const LARISSA_ESSENTIAL_PROMPT = ${JSON.stringify(essentialPrompt)};`,
  `export const LARISSA_OPTIONAL_MEMORIES = ${JSON.stringify(optionalMemories)};`,
  `export const QUESTION_INTENTS_CONTRACT_EXAMPLE = ${JSON.stringify(questionContract)};`,
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const current = fs.existsSync(generatedPath) ? fs.readFileSync(generatedPath, "utf8").replace(/\r\n/g, "\n") : "";
  if (current !== generated) {
    console.error("Prompt gerado desatualizado. Execute: node scripts/build-larissa-canonical-prompt.mjs");
    process.exitCode = 1;
  } else {
    console.log(`Prompt canônico ${version}: Markdown e módulo runtime sincronizados.`);
  }
} else {
  fs.writeFileSync(generatedPath, generated, "utf8");
  console.log(`Módulo runtime gerado para o prompt canônico ${version}.`);
}
