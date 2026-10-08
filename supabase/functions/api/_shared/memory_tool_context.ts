export const MEMORY_SCOPE_HEADER = "x-vendeo-memory-scope";

const MEMORY_TOOLS_REQUIRING_SCOPE = new Set([
  "contact_memory_search",
  "conversation_memory_search",
]);

export type MemoryToolPreparation =
  | {
      ok: true;
      toolName: "persona_memory_search" | "contact_memory_search" | "conversation_memory_search";
      arguments: Record<string, unknown>;
      scopeApplied: boolean;
    }
  | {
      ok: false;
      toolName: string;
      status: "tool_error";
      reasonCode: "memory_scope_missing";
      missingFields: ["scope"];
    };

function canonicalMemoryToolName(rawName: string): MemoryToolPreparation["toolName"] | null {
  const name = String(rawName || "").trim();
  const match = name.match(/(?:^|[:_])(persona|contact|conversation)_memory_search$/);
  if (!match) return null;
  return `${match[1]}_memory_search` as MemoryToolPreparation["toolName"];
}

/**
 * Prepara os argumentos semânticos de uma memory tool e injeta o capability
 * scope obtido fora do modelo. Argumentos `scope` fornecidos pelo Agent nunca
 * prevalecem sobre o valor associado à sessão/ciclo.
 */
export function prepareMemoryToolCall(
  rawToolName: string,
  modelArgs: unknown,
  ephemeralScopeId: string | null | undefined,
): MemoryToolPreparation {
  const toolName = canonicalMemoryToolName(rawToolName);
  if (!toolName) {
    return {
      ok: false,
      toolName: String(rawToolName || "unknown"),
      status: "tool_error",
      reasonCode: "memory_scope_missing",
      missingFields: ["scope"],
    };
  }

  const args = modelArgs && typeof modelArgs === "object" && !Array.isArray(modelArgs)
    ? { ...(modelArgs as Record<string, unknown>) }
    : {};

  if (!MEMORY_TOOLS_REQUIRING_SCOPE.has(toolName)) {
    delete args.scope;
    return { ok: true, toolName, arguments: args, scopeApplied: false };
  }

  const scopeId = typeof ephemeralScopeId === "string" ? ephemeralScopeId.trim() : "";
  if (!scopeId.startsWith("scope_") || scopeId.length <= "scope_".length) {
    return {
      ok: false,
      toolName,
      status: "tool_error",
      reasonCode: "memory_scope_missing",
      missingFields: ["scope"],
    };
  }

  args.scope = scopeId;
  return { ok: true, toolName, arguments: args, scopeApplied: true };
}

export function classifyMemorySearchStatus(params: {
  isError?: boolean;
  error?: unknown;
  found?: boolean;
  resultCount?: number;
}): "success_with_results" | "success_no_results" | "tool_error" {
  if (params.isError || params.error) return "tool_error";
  return params.found === true || (params.resultCount ?? 0) > 0
    ? "success_with_results"
    : "success_no_results";
}
