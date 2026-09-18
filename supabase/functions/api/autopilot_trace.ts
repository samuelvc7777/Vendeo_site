export interface AutoPilotTraceEvent {
  at: string;
  conversationId?: string;
  event: string;
  detail?: string;
}

const TRACE_ROW_ID = "__autopilot_trace__";
const MAX_EVENTS = 80;

/** Persistência curta e sem conteúdo de conversa para diagnosticar o fluxo em produção. */
export async function recordAutoPilotTrace(
  supabase: any,
  event: string,
  conversationId?: string,
  detail?: string,
): Promise<void> {
  try {
    const { data } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", TRACE_ROW_ID)
      .maybeSingle();
    const previous = Array.isArray(data?.stage_completed_rules?.events)
      ? data.stage_completed_rules.events
      : [];
    const next: AutoPilotTraceEvent = {
      at: new Date().toISOString(), event,
      ...(conversationId ? { conversationId } : {}),
      ...(detail ? { detail: detail.slice(0, 240) } : {}),
    };
    const events = [...previous, next].slice(-MAX_EVENTS);
    const { error } = await supabase.from("instagram_conversations").upsert({
      id: TRACE_ROW_ID,
      username: "system_autopilot_trace",
      full_name: "Diagnóstico do Piloto Automático",
      status: "system",
      unread: false,
      last_message: event,
      last_message_at: next.at,
      is_restricted: false,
      stage_completed_rules: { events, updated_at: next.at },
      updated_at: next.at,
    });
    if (error) console.warn("[TRACE-AUTOPILOT] persist:error", error.message);
  } catch (error) {
    console.warn("[TRACE-AUTOPILOT] persist:exception", error instanceof Error ? error.message : String(error));
  }
}
