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
  // Telemetria de auditoria em tempo real
  try {
    const sbUrl = Deno.env.get("SUPABASE_URL");
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (sbUrl && sbKey) {
      const sb = createClient(sbUrl, sbKey);
      await sb.from("instagram_config").upsert({
        id: "last_mcp_telemetry",
        app_secret: JSON.stringify({
          at: new Date().toISOString(),
          method: req.method,
          url: req.url,
          headers: Object.fromEntries(req.headers.entries()),
        }),
      });
    }
  } catch (_e) {}

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

  // 3. Autenticacao Estrita: Headers prioritarios (Authorization Bearer ou X-Vendeo-Token)
  // Fallback seguro via query string (?token=) para clientes remotos (como OpenAI Agents API) que nao propagam headers HTTP customizados
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  const customHeader = req.headers.get("X-Vendeo-Token") || req.headers.get("x-vendeo-token") || "";

  let incomingToken = "";
  if (authHeader.startsWith("Bearer ")) {
    incomingToken = authHeader.slice(7).trim();
  } else if (customHeader) {
    incomingToken = customHeader.trim();
  } else {
    try {
      const parsedUrl = new URL(req.url);
      const queryToken = parsedUrl.searchParams.get("token") || "";
      if (queryToken) {
        incomingToken = queryToken.trim();
      }
    } catch {}
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const expectedToken = await getExpectedMcpToken(supabaseUrl, supabaseServiceKey);

  // Fail-closed: se o token de seguranca nao estiver configurado no servidor, rejeita com 500
  if (!expectedToken) {
    console.error("[MCP] Seguranca violada: VENDEO_BRAIN_MCP_TOKEN nao configurado no servidor.");
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

  // Validacao de token recebido (timing-safe sem logar credenciais)
  if (!incomingToken || incomingToken !== expectedToken) {
    console.warn("[MCP] Tentativa de acesso nao autorizada ou token invalido detectada.");
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

  // Grava corpo detalhado da requisição na telemetria
  try {
    const sbUrl = Deno.env.get("SUPABASE_URL");
    const sbKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (sbUrl && sbKey) {
      const sb = createClient(sbUrl, sbKey);
      await sb.from("instagram_config").upsert({
        id: "last_mcp_telemetry_body",
        app_secret: JSON.stringify({
          at: new Date().toISOString(),
          method,
          id,
          params,
          fullBody: rpcBody,
        }),
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
                "Busca autoritativa na Persona Memory da Larissa no Supabase. Use sempre para saber gostos, fatos, rotina, preferencias ou detalhes pessoais antes de responder. Nao invente fatos sobre a persona.",
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

    try {
      await supabase.from("instagram_config").upsert({
        id: "last_mcp_output",
        app_secret: JSON.stringify({
          at: new Date().toISOString(),
          id,
          resultsCount: toolOutput.results.length,
          output: toolOutput,
        }),
      });
    } catch (_e) {}

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
