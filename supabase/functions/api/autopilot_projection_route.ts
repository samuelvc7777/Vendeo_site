type ProjectionPatch = (
  supabase: any,
  conversationId: string,
  statePatch: Record<string, unknown>,
  expectedStateUpdatedAt?: string,
) => Promise<Record<string, unknown>>;

type ProjectionPatchRouteOptions = {
  supabase: any;
  corsHeaders: HeadersInit;
  originAllowed: boolean;
  patchProjection: ProjectionPatch;
};

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: HeadersInit) {
  const headers = new Headers(corsHeaders);
  headers.set("Content-Type", "application/json");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

export async function handleAutoPilotProjectionPatchRoute(
  request: Request,
  options: ProjectionPatchRouteOptions,
): Promise<Response> {
  if (!options.originAllowed) {
    return jsonResponse({ success: false, error: "origin_not_allowed" }, 403, options.corsHeaders);
  }

  const body = await request.json().catch(() => null);
  const conversationId = typeof body?.conversationId === "string" ? body.conversationId.trim() : "";
  const statePatch = body?.statePatch;
  const expectedStateUpdatedAt = body?.expectedStateUpdatedAt;

  if (
    !conversationId || conversationId.length > 256 ||
    !statePatch || typeof statePatch !== "object" || Array.isArray(statePatch)
  ) {
    return jsonResponse({ success: false, error: "invalid_projection_patch" }, 400, options.corsHeaders);
  }

  if (
    expectedStateUpdatedAt !== undefined && expectedStateUpdatedAt !== null &&
    (typeof expectedStateUpdatedAt !== "string" || !Number.isFinite(Date.parse(expectedStateUpdatedAt)))
  ) {
    return jsonResponse({ success: false, error: "invalid_state_version" }, 400, options.corsHeaders);
  }

  if (new TextEncoder().encode(JSON.stringify(statePatch)).byteLength > 32768) {
    return jsonResponse({ success: false, error: "projection_patch_too_large" }, 413, options.corsHeaders);
  }

  try {
    const result = await options.patchProjection(
      options.supabase,
      conversationId,
      statePatch as Record<string, unknown>,
      typeof expectedStateUpdatedAt === "string" ? expectedStateUpdatedAt : undefined,
    );
    return jsonResponse(result, 200, options.corsHeaders);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "autopilot_projection_patch_failed";
    if (reason === "conversation_not_found") {
      return jsonResponse({ success: false, error: reason }, 404, options.corsHeaders);
    }
    return jsonResponse({ success: false, error: "autopilot_projection_patch_failed" }, 503, options.corsHeaders);
  }
}
