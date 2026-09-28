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

export async function patchAutoPilotProjectionState(
  supabase: any,
  conversationId: string,
  state: Record<string, any>,
  expectedStateUpdatedAt?: string,
) {
  const { data, error } = await supabase.rpc("patch_autopilot_projection_state_atomic", {
    p_conversation_id: conversationId,
    p_state_patch: state,
    ...(expectedStateUpdatedAt ? { p_expected_state_updated_at: expectedStateUpdatedAt } : {}),
  });
  if (error || data?.success !== true) {
    throw new Error(error?.message || data?.reason || "autopilot_projection_patch_failed");
  }
  return data as { success: true; applied: boolean; isEnabled: boolean; stateUpdatedAt?: string; stateRevision?: number; state?: Record<string, any>; previousState?: Record<string, any> };
}

export async function publishAutoPilotState(
  supabase: any,
  conversationId: string,
  patch: Record<string, any>,
) {
  try {
    const requestedAt = new Date().toISOString();
    const { cycleEvent, appendEvent, eventMetadata, event: legacyPatchEvent, ...statePatch } = patch;
    const projectionResult = await patchAutoPilotProjectionState(
      supabase, conversationId, { ...statePatch, stateUpdatedAt: requestedAt }
    );
    if (!projectionResult.applied) return;

    let updated = projectionResult.state as Record<string, any> | undefined;
    const previous = projectionResult.previousState || {};

    // Compatibilidade curta de rollout com a RPC antiga.
    if (!updated) {
      const { data: legacyRow } = await supabase.from("instagram_conversations")
        .select("stage_completed_rules").eq("id", "__autopilot_states__").maybeSingle();
      updated = legacyRow?.stage_completed_rules?.states?.[conversationId] || {
        ...statePatch, conversationId, isEnabled: projectionResult.isEnabled,
        stateUpdatedAt: projectionResult.stateUpdatedAt || requestedAt,
      };
    }

    const cycleId = statePatch.cycleId || statePatch.activity?.cycleId || updated?.cycleId || null;
    const legacyEvent = legacyPatchEvent || statePatch.activity?.event;
    const statusChanged = statePatch.status !== undefined && statePatch.status !== previous.status;
    const phaseChanged = statePatch.activity?.phase !== undefined && statePatch.activity?.phase !== previous.activity?.phase;
    const shouldAppendEvent = Boolean(
      (appendEvent !== false && (cycleEvent || legacyEvent || appendEvent === true)) || statusChanged || phaseChanged
    );

    if (cycleId && shouldAppendEvent) {
      const eventData = cycleEvent || {};
      const event = eventData.event || legacyEvent ||
        (phaseChanged ? `phase_${statePatch.activity?.phase}` : statusChanged ? `status_${statePatch.status}` : statePatch.activity?.label);
      if (event) {
        try {
          await supabase.from("brain_turn_events").insert({
            conversation_id: conversationId,
            event_type: String(event),
            status: String(statePatch.status || eventData.phase || "observed"),
            human_message: String(eventData.detail || eventData.label || statePatch.activity?.detail || event).slice(0, 1000),
            metadata: {
              cycleId,
              phase: eventData.phase || statePatch.activity?.phase || null,
              label: eventData.label || statePatch.activity?.label || String(event),
              ...(eventData.metadata && typeof eventData.metadata === "object" ? eventData.metadata : {}),
              ...(eventMetadata && typeof eventMetadata === "object" ? eventMetadata : {}),
            },
          });
        } catch (eventError) {
          console.warn("[AutoPilot State] Falha ao gravar evento can?nico do Brain:", eventError);
        }
      }
    }

    const realtimeChannel = supabase.channel("vendeo_realtime_chat");
    await realtimeChannel.send({
      type: "broadcast", event: "autopilot_state_update",
      payload: { ...updated, timestamp: updated.stateUpdatedAt || requestedAt },
    });
  } catch (error) {
    console.warn("[AutoPilot State] Falha ao publicar estado visual:", error);
  }
}
