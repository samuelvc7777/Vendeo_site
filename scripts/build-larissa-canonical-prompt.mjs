#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const markdownPath = path.join(root, "supabase/functions/api/larissa_canonical_prompt.md");
const generatedPath = path.join(root, "supabase/functions/api/larissa_canonical_prompt.generated.ts");
const prompt = fs.readFileSync(markdownPath, "utf8").trim();
const version = prompt.match(/^VENDEO_AGENT_INSTRUCTIONS_VERSION: (\S+)$/m)?.[1];
const questionContract = prompt.match(/\[\n  \{\n    "responseIndex": 1,[\s\S]*?\n  \}\n\]/)?.[0];
if (!questionContract) throw new Error("Contrato questionIntents não encontrado no Markdown.");
if (!version) throw new Error("O Markdown precisa declarar VENDEO_AGENT_INSTRUCTIONS_VERSION.");
const generated = [
  "/** Arquivo gerado; edite larissa_canonical_prompt.md. */",
  `export const LARISSA_CANONICAL_PROMPT_VERSION = ${JSON.stringify(version)};`,
  `export const LARISSA_CANONICAL_PROMPT = ${JSON.stringify(prompt)};`,
  `export const QUESTION_INTENTS_CONTRACT_EXAMPLE = ${JSON.stringify(questionContract)};`,
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const current = fs.existsSync(generatedPath) ? fs.readFileSync(generatedPath, "utf8") : "";
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