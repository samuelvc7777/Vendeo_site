// supabase/functions/api/autopilot_state.ts
// Gerenciamento e publicação de estado do AutoPilot (Brain) desacoplado do legado.

export function activity(
  phase: string,
  label: string,
  detail: string,
  extra: Record<string, any> = {},
) {
  return { phase, label, detail, updatedAt: new Date().toISOString(), ...extra };
}

export async function publishAutoPilotState(
  supabase: any,
  conversationId: string,
  patch: Record<string, any>,
) {
  try {
    const { data: row } = await supabase
      .from("instagram_conversations")
      .select("stage_completed_rules")
      .eq("id", "__autopilot_states__")
      .maybeSingle();
    const states = row?.stage_completed_rules?.states || {};
    const current = states[conversationId] || {
      conversationId,
      isEnabled: true,
      status: "idle",
    };
    const stateUpdatedAt = new Date().toISOString();
    const updated = {
      ...current,
      isEnabled: patch.isEnabled !== undefined ? patch.isEnabled : true,
      ...patch,
      conversationId,
      stateUpdatedAt,
    };
    states[conversationId] = updated;

    await supabase.from("instagram_conversations").upsert({
      id: "__autopilot_states__",
      username: "system_autopilot_states",
      stage_completed_rules: { states, updated_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    });

    const realtimeChannel = supabase.channel("vendeo_realtime_chat");
    await realtimeChannel.send({
      type: "broadcast",
      event: "autopilot_state_update",
      payload: { ...updated, timestamp: stateUpdatedAt },
    });
  } catch (error) {
    // O indicador é observabilidade: uma falha visual nunca deve interromper o atendimento.
    console.warn("[AutoPilot State] Falha ao publicar estado visual:", error);
  }
}
