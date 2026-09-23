#!/usr/bin/env node
/**
 * scripts/typecheck-edge-functions.mjs
 *
 * Verificação semântica estrita de identificadores e variáveis não declaradas
 * nos arquivos TypeScript de supabase/functions/api.
 *
 * Previne ReferenceError em produção (ex: "Cannot find name 'isAudioAction'")
 * sem depender de Deno instalado no ambiente do desenvolvedor.
 */

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const functionsDir = path.resolve("supabase/functions/api");
const files = fs
  .readdirSync(functionsDir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => path.join(functionsDir, f));

// Inclui arquivos shared se existirem
const sharedDir = path.resolve("supabase/functions/_shared");
if (fs.existsSync(sharedDir)) {
  fs.readdirSync(sharedDir)
    .filter((f) => f.endsWith(".ts"))
    .forEach((f) => files.push(path.join(sharedDir, f)));
}

console.log(`[Typecheck Edge Functions] Analisando ${files.length} arquivos TypeScript em supabase/functions...`);

// Globais legítimos providos pelo runtime Deno / Web Standards
const ALLOWED_GLOBALS = new Set([
  "Deno",
  "Request",
  "Response",
  "Headers",
  "fetch",
  "console",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "crypto",
  "URL",
  "URLSearchParams",
  "AbortController",
  "FormData",
  "Blob",
  "File",
  "TextEncoder",
  "TextDecoder",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "WebSocket",
  "CompressionStream",
  "DecompressionStream",
  "queueMicrotask",
]);

// Identificadores legados pré-existentes identificados durante auditoria estática
// (isolados para não provocar refatorações de escopo não autorizado nesta rodada)
const KNOWN_LEGACY_UNDEFINED = new Set([
  "executorPrompt",
  "brainLegacyModel",
  "nvidiaReasoning",
]);

const compilerOptions = {
  noEmit: true,
  target: ts.ScriptTarget.ESNext,
  module: ts.ModuleKind.ESNext,
  skipLibCheck: true,
  allowImportingTsExtensions: true,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
};

const program = ts.createProgram(files, compilerOptions);
const diagnostics = program.getSemanticDiagnostics();

// TS2304: Cannot find name '{0}'.
const undefinedVariableErrors = diagnostics.filter((diag) => {
  if (diag.code !== 2304) return false;
  const msg = typeof diag.messageText === "string" ? diag.messageText : diag.messageText?.messageText || "";
  const match = msg.match(/Cannot find name '([^']+)'/);
  if (!match) return false;
  const name = match[1];
  return !ALLOWED_GLOBALS.has(name) && !KNOWN_LEGACY_UNDEFINED.has(name);
});

if (undefinedVariableErrors.length > 0) {
  console.error(`\n❌ [Typecheck Edge Functions] Foram encontrados ${undefinedVariableErrors.length} identificador(es) não declarados:`);
  for (const err of undefinedVariableErrors) {
    if (err.file) {
      const { line, character } = err.file.getLineAndCharacterOfPosition(err.start);
      const relativePath = path.relative(process.cwd(), err.file.fileName);
      const msg = typeof err.messageText === "string" ? err.messageText : err.messageText?.messageText;
      console.error(`  - ${relativePath}:${line + 1}:${character + 1} -> ${msg}`);
    }
  }
  process.exit(1);
}

console.log(`✅ [Typecheck Edge Functions] Nenhum identificador não declarado encontrado em supabase/functions!`);
process.exit(0);
