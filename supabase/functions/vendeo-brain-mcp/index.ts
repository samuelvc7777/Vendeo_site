// Supabase Edge Function - Vendeo Remote MCP Server (vendeo_memory)
// Implementa Model Context Protocol (MCP) sobre HTTP para o OpenAI Agent Brain
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";
import { searchPersonaMemory, formatPersonaMemoryForToolOutput } from "./_shared/persona_memory.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, mcp-session-id, accept, x-vendeo-token",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
};

const MCP_SERVER_NAME = "vendeo_memory";
const MCP_SERVER_VERSION = "1.0.0";
const MCP_PROTOCOL_VERSION = "2024-11-05";

// Token dedicado do MCP (fallback de seguranca caso nao configurado via secrets do Supabase)
const EXPECTED_TOKEN = Deno.env.get("VENDEO_BRAIN_MCP_TOKEN") || "vendeo_mcp_9d9632705870db95938e6f3088e5e0cc542d75f9ab1947a9";

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

  // 3. Autenticacao Dedicada (NUNCA usar SERVICE_ROLE_KEY aqui)
  // Suporta Authorization: Bearer <TOKEN>, X-Vendeo-Token: <TOKEN> ou ?token=<TOKEN>
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const customHeader = req.headers.get("X-Vendeo-Token") || req.headers.get("x-vendeo-token") || "";
  const urlObj = new URL(req.url);
  const queryToken = urlObj.searchParams.get("token") || "";

  let token = "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (customHeader) {
    token = customHeader.trim();
  } else if (queryToken) {
    token = queryToken.trim();
  }

  if (!token || token !== EXPECTED_TOKEN) {
    console.warn("[MCP] Tentativa de acesso nao autorizada ou token invalido");
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        error: {
          code: -32000,
          message: "Unauthorized: Invalid or missing Bearer token",
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
    responseHeaders["Mcp-Session-Id"] = sessionId;
  }

  // 4. Parsing da mensagem JSON-RPC
  let rpcBody: any;
  try {
    rpcBody = await req.json();
  } catch (_err) {
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
            "Use persona_memory_search para pesquisar fatos oficiais e preferências da Larissa no Supabase.",
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
            "Use persona_memory_search para pesquisar fatos oficiais e preferências da Larissa no Supabase.",
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
                "Consulta a memoria canonica e temporal da Larissa para recuperar fatos pessoais confiaveis (hobbies, preferencias, rotina, estudos, etc). Retorna os fatos encontrados.",
              inputSchema: {
                type: "object",
                properties: {
                  query: {
                    type: "string",
                    description:
                      "Termo de busca ou pergunta sobre a Larissa (ex: motocross, curso, comida favorita, onde mora)",
                    maxLength: 200,
                  },
                  limit: {
                    type: "integer",
                    description: "Quantidade maxima de fatos a retornar (1 a 8, default 5)",
                    minimum: 1,
                    maximum: 8,
                    default: 5,
                  },
                },
                required: ["query"],
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

    const toolArgs = params?.arguments || {};

    if (!isPersonaTool) {
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

    console.log("[MCP] request_received");
    console.log("[MCP] tool_called persona_memory_search");

    // Sanitizacao rigorosa dos argumentos recebidos da OpenAI
    let query = typeof toolArgs?.query === "string" ? toolArgs.query.trim().slice(0, 200) : "";
    let limit = 5;
    if (typeof toolArgs?.limit === "number" && !isNaN(toolArgs.limit)) {
      limit = Math.min(Math.max(Math.floor(toolArgs.limit), 1), 8);
    }

    console.log(`[MCP] persona_query="${query}"`);

    // Obtencao do cliente Supabase para consulta segura a tabela oficial public.persona_memory
    const supabaseUrl = Deno.env.get("SUPABASE_URL") || "https://wsdualhvopidgqcumonr.supabase.co";
    const supabaseServiceKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzZHVhbGh2b3BpZGdxY3Vtb25yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODkwODM4OSwiZXhwIjoyMTA0NDg0Mzg5fQ.ebpH41NJdrNgRbgch4ciTxTS6SppRRoJzSPoyEmN2MU";

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    let hits: any[] = [];
    try {
      hits = await searchPersonaMemory({
        supabase,
        personaId: "larissa",
        query,
        limit,
        allowLegacyFallback: true,
      });
    } catch (err) {
      console.error("[MCP] Erro ao consultar searchPersonaMemory:", err);
      hits = [];
    }

    const toolOutput = formatPersonaMemoryForToolOutput(hits);

    console.log(`[MCP] persona_results=${toolOutput.results.length}`);
    console.log("[MCP] response_completed");

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
