// supabase/functions/api/autopilot_state.ts
// Gerenciamento e publicação de estado do AutoPilot (Brain) desacoplado do legado.
import { dispatchCriticalWebPush } from "./web_push.ts";

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
  return data as { success: true; applied: boolean; reason?: string; isEnabled: boolean; stateUpdatedAt?: string; stateRevision?: number; state?: Record<string, any>; previousState?: Record<string, any> };
}

export async function publishAutoPilotState(
  supabase: any,
  conversationId: string,
  patch: Record<string, any>,
) {
  try {
    const requestedAt = new Date().toISOString();
    const { cycleEvent, appendEvent, eventMetadata, event: patchEvent, ...statePatch } = patch;

    // O push crítico é independente da projeção visual. Isso garante o alerta
    // mesmo quando a conversa acabou de ser desabilitada/finalizada atomicamente.
    const preProjectionEventName = String(cycleEvent?.event || patchEvent || "");
    const preProjectionCycleId = statePatch.cycleId || statePatch.activity?.cycleId || null;
    if (preProjectionEventName === "manual_resolution_required") {
      try {
        await dispatchCriticalWebPush({
          supabase,
          eventType: "manual_resolution_required",
          conversationId,
          eventKey: `manual_resolution_required:${conversationId}:${preProjectionCycleId || requestedAt}`,
          body: String(cycleEvent?.detail || statePatch.pauseReason || "O Brain precisa de uma informação sua para continuar."),
        });
      } catch (pushError) {
        console.warn("[AutoPilot State] Falha no push crítico pré-projeção:", pushError);
      }
    } else if (preProjectionEventName === "cycle_completed") {
      try {
        const { data: finalizedConversation } = await supabase
          .from("instagram_conversations")
          .select("is_converted, stage_completed_rules")
          .eq("id", conversationId)
          .maybeSingle();
        const finalized = finalizedConversation?.is_converted === true
          || finalizedConversation?.stage_completed_rules?.workflow_finalized === true;
        if (finalized) {
          await dispatchCriticalWebPush({
            supabase,
            eventType: "workflow_finalized",
            conversationId,
            eventKey: `workflow_finalized:${conversationId}`,
          });
        }
      } catch (pushError) {
        console.warn("[AutoPilot State] Falha no push final pré-projeção:", pushError);
      }
    }

    const projectionResult = await patchAutoPilotProjectionState(
      supabase, conversationId, { ...statePatch, stateUpdatedAt: requestedAt }
    );
    if (!projectionResult.applied && projectionResult.reason !== "semantic_noop") return;

    const updated = projectionResult.state as Record<string, any>;
    if (!updated) throw new Error("canonical_projection_state_missing");
    const previous = projectionResult.previousState || {};
    const projectionApplied = projectionResult.applied === true;

    const cycleId = statePatch.cycleId || statePatch.activity?.cycleId || updated?.cycleId || null;
    const patchEventName = patchEvent || statePatch.activity?.event;
    const statusChanged = statePatch.status !== undefined && statePatch.status !== previous.status;
    const phaseChanged = statePatch.activity?.phase !== undefined && statePatch.activity?.phase !== previous.activity?.phase;
    const shouldAppendEvent = Boolean(
      (appendEvent !== false && (
        cycleEvent ||
        appendEvent === true ||
        (projectionApplied && patchEventName)
      )) ||
      (projectionApplied && (statusChanged || phaseChanged))
    );

    if (cycleId && shouldAppendEvent) {
      const eventData = cycleEvent || {};
      const event = eventData.event || patchEventName ||
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

    // A atualização da linha em autopilot_chat_states já é publicada pelo
    // Postgres Realtime. Não duplicamos o mesmo estado via Broadcast.
  } catch (error) {
    console.warn("[AutoPilot State] Falha ao publicar estado visual:", error);
  }
}
