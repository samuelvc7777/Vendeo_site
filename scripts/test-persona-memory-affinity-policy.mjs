#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";

const brainSource = fs.readFileSync("supabase/functions/api/openai_brain.ts", "utf8");
const mcpSource = fs.readFileSync("supabase/functions/vendeo-brain-mcp/index.ts", "utf8");

assert.match(brainSource, /AFFINITY CHECK/, "Brain deve declarar a política AFFINITY CHECK");
assert.match(brainSource, /não conhece toda a PersonaMemory carregada de antemão/i, "Brain deve reconhecer o limite epistêmico do contexto");
assert.match(brainSource, /ANTES de concluir que não existe afinidade ou conexão pessoal relevante/i, "Brain deve consultar memória antes de negar afinidade");
assert.match(brainSource, /Máximo recomendado: 1 busca PersonaMemory/i, "Brain deve limitar buscas redundantes");
assert.match(brainSource, /memoryConsulted/i, "Plano deve expor memoryConsulted");
assert.match(brainSource, /memoryRationale/i, "Plano deve expor memoryRationale");

assert.match(mcpSource, /afinidade/i, "Tool MCP deve explicar afinidade");
assert.match(mcpSource, /profissão|profissao/i, "Tool MCP deve citar profissão");
assert.match(mcpSource, /formação|formacao/i, "Tool MCP deve citar formação");
assert.match(mcpSource, /reação pessoal|reacao pessoal/i, "Tool MCP deve citar reação pessoal");

console.log("✅ Política AFFINITY CHECK e descrição MCP presentes");
