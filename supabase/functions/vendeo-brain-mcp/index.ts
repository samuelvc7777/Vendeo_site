// Supabase Edge Function - Vendeo Remote MCP Server (vendeo_memory)
// Implementa Model Context Protocol (MCP) sobre HTTP para o OpenAI Agent Brain
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import {
  searchPersonaMemory,
  formatPersonaMemoryForToolOutput,
  sanitizeMcpTelemetry,
  type SanitizedMcpTelemetry,
} from "./_shared/persona_memory.ts";
import {
  resolveMemoryScope,
  searchMcpContactMemory,
  searchMcpConversationMemory,
} from "./_shared/mcp_memory_helpers.ts";
export { sanitizeMcpTelemetry, type SanitizedMcpTelemetry };

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, mcp-session-id, accept",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
};

const MCP_SERVER_NAME = "vendeo_memory";
const MCP_SERVER_VERSION = "1.0.0";
const MCP_PROTOCOL_VERSION = "2024-11-05";

// Cache do token esperado em memoria (evita roundtrip ao banco a cada invocacao)
let cachedExpectedToken: string | null = null;
let cacheExpiresAt = 0;

async function getExpectedMcpToken(supabaseUrl?: string, supabaseServiceKey?: string): Promise<string | null> {
  const envToken = (Deno.env.get("VENDEO_BRAIN_MCP_TOKEN") || "").trim();
  if (envToken) return envToken;

  const now = Date.now();
  if (cachedExpectedToken && cacheExpiresAt > now) {
    return cachedExpectedToken;
  }

  if (supabaseUrl && supabaseServiceKey) {
    try {
      const supabase = createClient(supabaseUrl, supabaseServiceKey);
      const { data } = await supabase
        .from("instagram_config")
        .select("app_secret")
        .eq("id", "vendeo_brain_mcp_token")
        .maybeSingle();

      if (data?.app_secret && typeof data.app_secret === "string" && data.app_secret.trim()) {
        cachedExpectedToken = data.app_secret.trim();
        cacheExpiresAt = now + 60 * 1000;
        return cachedExpectedToken;
      }
    } catch (err) {
      console.warn("[MCP] Erro ao consultar vendeo_brain_mcp_token no instagram_config:", err);
    }
  }

  return null;
}

serve(async (req: Request) => {
  // 1. Tratamento de CORS Preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // 2. Health check / Discovery via GET
  if (req.method === "GET") {
    return new Response(
      JSON.stringify({
        status: "ok",
        server: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION,
        protocol: MCP_PROTOCOL_VERSION,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3. Autenticação Estrita: ÚNICA SUPERFÍCIE (Authorization: Bearer <TOKEN>)
  // Se vier ?token= na URL, rejeitar imediatamente com 401 (não processar nem logar o valor)
  try {
    const parsedUrl = new URL(req.url);
    if (parsedUrl.searchParams.has("token")) {
      console.warn("[MCP] Tentativa de acesso com ?token= rejeitada com 401 (proibido).");
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: {
            code: -32000,
            message: "Unauthorized: query token authentication is deprecated and prohibited",
          },
          id: null,
        }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  } catch (_e) {}

  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  let incomingToken = "";
  if (authHeader.startsWith("Bearer ")) {
    incomingToken = authHeader.slice(7).trim();
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const expectedToken = await getExpectedMcpToken(supabaseUrl, supabaseServiceKey);

  // Fail-closed: se o token de segurança não estiver configurado no servidor, rejeita com 500
  if (!expectedToken) {
    console.error("[MCP] Segurança violada: VENDEO_BRAIN_MCP_TOKEN não configurado no servidor.");
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Internal server error: MCP security configuration missing",
        },
        id: null,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // Validação estrita: se não for Bearer token válido correspondente, rejeita com 401
  if (!incomingToken || incomingToken !== expectedToken) {
    console.warn("[MCP] Tentativa de acesso não autorizada (Bearer token ausente ou inválido).");
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Unauthorized: Valid Authorization Bearer token required",
        },
        id: null,
      }),
      {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  const sessionId = req.headers.get("mcp-session-id") || req.headers.get("Mcp-Session-Id") || undefined;
  const responseHeaders: Record<string, string> = {
    ...corsHeaders,
    "Content-Type": "application/json",
  };
  if (sessionId) {
    responseHeaders["mcp-session-id"] = sessionId;
  }

  // 4. Parse do corpo JSON-RPC
  let rpcBody: any;
  try {
    rpcBody = await req.json();
  } catch (_e) {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32700,
          message: "Parse error: invalid JSON",
        },
        id: null,
      }),
      {
        status: 400,
        headers: responseHeaders,
      }
    );
  }

  const id = rpcBody?.id ?? null;
  const method = rpcBody?.method;
  const params = rpcBody?.params;

  console.log(`[MCP] Request received: method=${method}, id=${id}`);

  // Grava telemetria ESTRITAMENTE SANITIZADA (NUNCA grava req.headers, fullBody ou URL com query)
  try {
    const sbUrl = Deno.env.get("SUPABASE_URL");
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (sbUrl && sbKey) {
      const sb = createClient(sbUrl, sbKey);
      const safeTelemetry = sanitizeMcpTelemetry(req, rpcBody);
      await sb.from("instagram_config").upsert({
        id: "last_mcp_telemetry_body",
        app_secret: JSON.stringify(safeTelemetry),
      });
    }
  } catch (_e) {}

  // 5. Roteamento de Metodos do Protocolo MCP
  if (method === "server/discover") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: "2026-07-28",
          supportedVersions: ["2026-07-28", "2024-11-05", "2024-10-07"],
          capabilities: {
            tools: {
              listChanged: false,
            },
            resources: {
              subscribe: false,
              listChanged: false,
            },
            prompts: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: MCP_SERVER_NAME,
            version: MCP_SERVER_VERSION,
          },
          _meta: {
            "io.modelcontextprotocol/serverInfo": {
              name: MCP_SERVER_NAME,
              version: MCP_SERVER_VERSION,
            },
          },
          instructions:
            "vendeo_memory: Use persona_memory_search para pesquisar fatos oficiais da Larissa. Use contact_memory_search (com o parâmetro scope) para fatos/citações do pretendente. Use conversation_memory_search (com o parâmetro scope) para episódios/open loops/histórico.",
        },
      }),
      { status: 200, headers: responseHeaders }
    );
  }

  if (method === "initialize") {
    const clientProtocol = params?.protocolVersion || "2026-07-28";
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          protocolVersion: clientProtocol,
          capabilities: {
            tools: {
              listChanged: false,
            },
            resources: {
              subscribe: false,
              listChanged: false,
            },
            prompts: {
              listChanged: false,
            },
          },
          serverInfo: {
            name: MCP_SERVER_NAME,
            version: MCP_SERVER_VERSION,
          },
          instructions:
            "vendeo_memory: Use persona_memory_search para pesquisar fatos oficiais da Larissa. Use contact_memory_search (com o parâmetro scope) para fatos/citações do pretendente. Use conversation_memory_search (com o parâmetro scope) para episódios/open loops/histórico.",
        },
      }),
      { status: 200, headers: responseHeaders }
    );
  }

  if (method === "notifications/initialized" || method === "initialized") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {},
      }),
      { status: 200, headers: responseHeaders }
    );
  }

  if (method === "ping") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {},
      }),
      { status: 200, headers: responseHeaders }
    );
  }

  if (method === "tools/list") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          tools: [
            {
              name: "persona_memory_search",
              description:
                "Busca autoritativa na PersonaMemory da Larissa no Supabase para descobrir fatos reais que gerem afinidade, conexão pessoal, reação autêntica, experiência parecida, diferença interessante, comentário pessoal ou grounding factual. Use para profissão, formação, estudos, hobbies, experiências, viagens, rotina, preferências, gostos, hábitos, valores e reação pessoal. Quando o pretendente revelar um fato pessoal relevante e o contexto não trouxer informação suficiente da Larissa sobre o tema, prefira consultar antes de concluir que não existe conexão. Retorne apenas fatos úteis ao turno; não invente fatos sobre a persona.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description: "Termo de busca ou pergunta para encontrar na Persona Memory (ex: 'motocross', 'strogonoff', 'trabalho', 'idade')",
                  },
                  limit: {
                    type: "integer",
                    description: "Quantidade maxima de fatos relevantes a retornar (padrao 5, max 8)",
                    default: 5,
                  },
                },
                required: ["query"],
              },
            },
            {
              name: "contact_memory_search",
              description:
                "Busca autoritativa em Contact Memory (Fatos e Citações do Pretendente) no Supabase. Permite consultar fatos duráveis (idade, profissão, gostos, rotina, planos, família, pets, dados pessoais) e frases marcantes do pretendente. REQUER o parâmetro 'scope' (o capability scope do turno atual). Use quando precisar recuperar ou confirmar detalhes já revelados pelo pretendente.",
              inputSchema: {
                type: "object",
                properties: {
                  scope: {
                    type: "string",
                    description: "Capability Scope efêmero gerado pelo backend para o turno atual (ex: 'scope_...')",
                  },
                  query: {
                    type: "string",
                    description: "Termo de busca ou pergunta sobre fatos ou citações do pretendente (ex: 'onde mora', 'idade', 'trabalho', 'irmã', 'moto')",
                  },
                  scopes: {
                    type: "array",
                    items: { type: "string", enum: ["facts", "entities", "quotes"] },
                    description: "Escopos opcionais de busca em Contact Memory (padrão: ['facts', 'entities', 'quotes'])",
                  },
                  limit: {
                    type: "integer",
                    description: "Quantidade máxima de resultados a retornar (padrão 5, máx 8)",
                    default: 5,
                  },
                },
                required: ["scope", "query"],
              },
            },
            {
              name: "conversation_memory_search",
              description:
                "Busca autoritativa em Conversation Memory (Episódios passados, Atos de fala, Open loops pendentes e Histórico da conversa) no Supabase. Permite consultar eventos marcantes, temas discutidos, promessas/combinados pendentes, autorrevelações já feitas pela Larissa ou histórico bruto. REQUER o parâmetro 'scope' (o capability scope do turno atual). Use para evitar perguntas repetidas, honrar combinados e recuperar contexto de turnos anteriores.",
              inputSchema: {
                type: "object",
                properties: {
                  scope: {
                    type: "string",
                    description: "Capability Scope efêmero gerado pelo backend para o turno atual (ex: 'scope_...')",
                  },
                  query: {
                    type: "string",
                    description: "Termo de busca sobre episódios, combinados, perguntas anteriores ou temas",
                  },
                  scopes: {
                    type: "array",
                    items: { type: "string", enum: ["episodes", "speech_acts", "open_loops", "history"] },
                    description: "Escopos opcionais de busca em Conversation Memory (padrão: ['episodes', 'speech_acts', 'open_loops', 'history'])",
                  },
                  limit: {
                    type: "integer",
                    description: "Quantidade máxima de resultados a retornar (padrão 5, máx 8)",
                    default: 5,
                  },
                },
                required: ["scope", "query"],
              },
            },
          ],
        },
      }),
      { status: 200, headers: responseHeaders }
    );
  }

  if (method === "resources/list") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          resources: [],
        },
      }),
      { status: 200, headers: responseHeaders }
    );
  }

  if (method === "resources/templates/list") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          resourceTemplates: [],
        },
      }),
      { status: 200, headers: responseHeaders }
    );
  }

  if (method === "prompts/list") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id,
        result: {
          prompts: [],
        },
      }),
      { status: 200, headers: responseHeaders }
    );
  }

  if (method === "tools/call") {
    const rawToolName = params?.name || "";
    const isPersonaTool =
      rawToolName === "persona_memory_search" ||
      rawToolName.endsWith(":persona_memory_search") ||
      rawToolName.endsWith("_persona_memory_search") ||
      rawToolName.includes("persona_memory_search");

    const isContactTool =
      rawToolName === "contact_memory_search" ||
      rawToolName.endsWith(":contact_memory_search") ||
      rawToolName.endsWith("_contact_memory_search") ||
      rawToolName.includes("contact_memory_search");

    const isConversationTool =
      rawToolName === "conversation_memory_search" ||
      rawToolName.endsWith(":conversation_memory_search") ||
      rawToolName.endsWith("_conversation_memory_search") ||
      rawToolName.includes("conversation_memory_search");

    const toolArgs = params?.arguments || {};

    if (!isPersonaTool && !isContactTool && !isConversationTool) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `Tool '${rawToolName}' not found on server '${MCP_SERVER_NAME}'`,
          },
        }),
        { status: 200, headers: responseHeaders }
      );
    }

    // Obtencao do cliente Supabase para consulta segura
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[MCP] Erro de infraestrutura: SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausente.");
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: "Database service configuration missing",
          },
        }),
        { status: 500, headers: responseHeaders }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 1. PERSONA MEMORY SEARCH
    if (isPersonaTool) {
      console.log("[MCP] request_received: persona_memory_search");

      // Sanitizacao rigorosa dos argumentos recebidos da OpenAI
      let query = typeof toolArgs?.query === "string" ? toolArgs.query.trim().slice(0, 200) : "";
      let limit = 5;
      if (typeof toolArgs?.limit === "number" && !isNaN(toolArgs.limit)) {
        limit = Math.min(Math.max(Math.floor(toolArgs.limit), 1), 8);
      }

      console.log(`[MCP] persona_query_received length=${query.length}`);

      let hits: any[] = [];
      try {
        hits = await searchPersonaMemory({
          supabase,
          personaId: "larissa",
          query,
          limit,
          allowLegacyFallback: false,
        });
      } catch (err) {
        console.error("[MCP] Erro ao consultar searchPersonaMemory:", err);
        hits = [];
      }

      const toolOutput = formatPersonaMemoryForToolOutput(hits);
      console.log(`[MCP] persona_results=${toolOutput.results.length}`);

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(toolOutput),
              },
            ],
            isError: false,
          },
        }),
        { status: 200, headers: responseHeaders }
      );
    }

    // 2. CONTACT MEMORY SEARCH
    if (isContactTool) {
      console.log("[MCP] request_received: contact_memory_search");
      const incomingScope = typeof toolArgs?.scope === "string" ? toolArgs.scope.trim() : "";
      let query = typeof toolArgs?.query === "string" ? toolArgs.query.trim().slice(0, 200) : "";
      let limit = 5;
      if (typeof toolArgs?.limit === "number" && !isNaN(toolArgs.limit)) {
        limit = Math.min(Math.max(Math.floor(toolArgs.limit), 1), 8);
      }

      const resolved = await resolveMemoryScope(supabase, incomingScope);
      if (!resolved) {
        console.warn(`[MCP] Scope inválido, expirado ou revogado para contact_memory_search: '${incomingScope}'`);
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "Invalid, expired, or unauthorized memory scope (FAIL_CLOSED)",
                    found: false,
                    results: [],
                  }),
                },
              ],
              isError: true,
            },
          }),
          { status: 200, headers: responseHeaders }
        );
      }

      const toolOutput = await searchMcpContactMemory({
        supabase,
        conversationId: resolved.conversationId,
        query,
        scopes: Array.isArray(toolArgs?.scopes) ? toolArgs.scopes : undefined,
        limit,
      });

      console.log(`[MCP] contact_memory_results=${toolOutput.results.length}`);

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(toolOutput),
              },
            ],
            isError: false,
          },
        }),
        { status: 200, headers: responseHeaders }
      );
    }

    // 3. CONVERSATION MEMORY SEARCH
    if (isConversationTool) {
      console.log("[MCP] request_received: conversation_memory_search");
      const incomingScope = typeof toolArgs?.scope === "string" ? toolArgs.scope.trim() : "";
      let query = typeof toolArgs?.query === "string" ? toolArgs.query.trim().slice(0, 200) : "";
      let limit = 5;
      if (typeof toolArgs?.limit === "number" && !isNaN(toolArgs.limit)) {
        limit = Math.min(Math.max(Math.floor(toolArgs.limit), 1), 8);
      }

      const resolved = await resolveMemoryScope(supabase, incomingScope);
      if (!resolved) {
        console.warn(`[MCP] Scope inválido, expirado ou revogado para conversation_memory_search: '${incomingScope}'`);
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id,
            result: {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({
                    error: "Invalid, expired, or unauthorized memory scope (FAIL_CLOSED)",
                    found: false,
                    results: [],
                  }),
                },
              ],
              isError: true,
            },
          }),
          { status: 200, headers: responseHeaders }
        );
      }

      const toolOutput = await searchMcpConversationMemory({
        supabase,
        conversationId: resolved.conversationId,
        query,
        scopes: Array.isArray(toolArgs?.scopes) ? toolArgs.scopes : undefined,
        limit,
      });

      console.log(`[MCP] conversation_memory_results=${toolOutput.results.length}`);

      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          result: {
            content: [
              {
                type: "text",
                text: JSON.stringify(toolOutput),
              },
            ],
            isError: false,
          },
        }),
        { status: 200, headers: responseHeaders }
      );
    }
  }

  // Metodo desconhecido
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: {
        code: -32601,
        message: `Method '${method}' not found`,
      },
    }),
    { status: 200, headers: responseHeaders }
  );
});
