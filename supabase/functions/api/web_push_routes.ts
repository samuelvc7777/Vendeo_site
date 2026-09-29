import {
  disableCriticalWebPushSubscription,
  getCriticalWebPushPublicConfig,
  registerCriticalWebPushSubscription,
} from "./web_push.ts";

export async function handleCriticalPushOperatorRoute(params: {
  request: Request;
  path: string;
  supabase: any;
  corsHeaders: Record<string, string>;
  operatorAuthenticated: boolean;
}): Promise<Response | null> {
  const { request, path, supabase, corsHeaders, operatorAuthenticated } = params;
  if (!path.startsWith("/operator/push/")) return null;

  if (!operatorAuthenticated) {
    return new Response(JSON.stringify({ error: "operator_auth_required" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (path === "/operator/push/config" && request.method === "GET") {
    const config = await getCriticalWebPushPublicConfig(supabase);
    return new Response(JSON.stringify(config), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (path === "/operator/push/subscription" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const result = await registerCriticalWebPushSubscription(
      supabase,
      body?.subscription,
      request.headers.get("user-agent"),
    );
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  if (path === "/operator/push/subscription" && request.method === "DELETE") {
    const body = await request.json().catch(() => ({}));
    const result = await disableCriticalWebPushSubscription(supabase, String(body?.endpoint || ""));
    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  return new Response(JSON.stringify({ error: "push_route_not_found" }), {
    status: 404,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
