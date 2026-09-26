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
    const stateUpdatedAt = new Date().toISOString();
    const { cycleEvent, appendEvent, eventMetadata, ...statePatch } = patch;
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
    const updated = {
      ...current,
      ...statePatch,
      isEnabled:
        statePatch.isEnabled !== undefined
          ? statePatch.isEnabled
          : current.isEnabled !== undefined
          ? current.isEnabled
          : true,
      conversationId,
      stateUpdatedAt,
    };
    const cycleId = statePatch.cycleId || statePatch.activity?.cycleId || current.cycleId || null;
    if (cycleId) {
      const isNewCycle = current.cycleId !== cycleId;
      updated.cycleId = cycleId;
      const previousEvents = !isNewCycle && Array.isArray(current.cycleEvents)
        ? current.cycleEvents
        : [];
      updated.cycleEvents = previousEvents;

      const legacyEvent = statePatch.event || statePatch.activity?.event;
      const shouldAppendEvent = appendEvent !== false && Boolean(cycleEvent || legacyEvent || appendEvent === true);
      if (shouldAppendEvent) {
        const eventData = cycleEvent || {};
        const event = eventData.event || legacyEvent || statePatch.activity?.label;
        if (event) {
          const lastSequence = previousEvents[previousEvents.length - 1]?.sequence || 0;
          updated.cycleEvents = [
            ...previousEvents,
            {
              cycleId,
              conversationId,
              sequence: lastSequence + 1,
              phase: eventData.phase || statePatch.activity?.phase || statePatch.status || "idle",
              event,
              label: eventData.label || statePatch.activity?.label || event,
              detail: eventData.detail ?? statePatch.activity?.detail,
              timestamp: stateUpdatedAt,
              metadata: eventData.metadata ?? eventMetadata ?? undefined,
            },
          ].slice(-100);
        }
      }
    }
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
