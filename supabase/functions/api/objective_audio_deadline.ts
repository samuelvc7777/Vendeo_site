export type ObjectiveAudioDeadline = {
  objectiveId: string;
  maxTurns: number;
  currentTurn: number;
  allowTemporalMismatch: boolean;
};

// Contagem operacional: versões/retries de uma decisão não são novos turnos.
export async function loadObjectiveAudioDeadline(params: {
  supabase: any;
  conversationId: string;
  stageId: string;
  objective: { id: string; actionType?: string; actionConfig?: Record<string, any> } | null;
}): Promise<ObjectiveAudioDeadline | null> {
  const config = params.objective?.actionConfig;
  const maxTurns = Number(config?.maxStageTurns);
  if (params.objective?.actionType !== "send_audio" || !Number.isInteger(maxTurns) || maxTurns < 1) return null;

  const { data: entries, error: entryError } = await params.supabase.from("brain_decisions")
    .select("created_at").eq("conversation_id", params.conversationId)
    .contains("stage_transition", { stageId: params.stageId })
    .order("created_at", { ascending: false }).limit(1);
  if (entryError) throw new Error("audio_deadline_stage_entry_failed");

  let query = params.supabase.from("brain_decisions").select("turn_id")
    .eq("conversation_id", params.conversationId).eq("decision_type", "respond")
    .eq("payload->semanticState->>expectedCurrentStageId", params.stageId);
  if (entries?.[0]?.created_at) query = query.gt("created_at", entries[0].created_at);
  const { data: decisions, error } = await query.order("created_at", { ascending: false }).limit(1000);
  if (error) throw new Error("audio_deadline_turn_count_failed");
  const completedTurns = new Set((decisions || []).map((row: any) => row.turn_id).filter(Boolean)).size;
  return {
    objectiveId: params.objective!.id,
    maxTurns,
    currentTurn: completedTurns + 1,
    allowTemporalMismatch: config?.allowAudioTemporalMismatch === true,
  };
}

export function validateObjectiveAudioDeadline(params: {
  deadline?: ObjectiveAudioDeadline | null;
  candidates?: Array<{ objectiveId: string; candidates: Array<{ audioId: string }> }>;
  plan: any;
}): string | null {
  const deadline = params.deadline;
  if (!deadline) return null;
  if (deadline.allowTemporalMismatch && params.plan?.action === "manual_resolution") {
    const reason = params.plan?.manualResolution?.reasonCategory;
    if (!["audio_content", "other"].includes(reason)) return "approved_audio_manual_reason_required: informe manualResolution.reasonCategory como audio_content ou other; não peça confirmação do áudio aprovado";
    if (reason === "audio_content") return "approved_audio_confirmation_forbidden: não solicite confirmação sobre horário ou conteúdo da gravação aprovada; inclua o áudio autorizado em outboundActions";
  }
  if (deadline.currentTurn < deadline.maxTurns) return null;
  // Pausas de segurança continuam possíveis; não substituímos decisões semânticas.
  if (["manual_resolution", "wait", "silent"].includes(params.plan?.action)) return null;
  const authorized = new Set((params.candidates || [])
    .filter((group) => group.objectiveId === deadline.objectiveId)
    .flatMap((group) => group.candidates.map((candidate) => candidate.audioId)));
  if (!authorized.size) return "objective_audio_deadline_no_eligible_audio: solicite resolução manual; não invente áudio";
  const audio = (params.plan?.outboundActions || [])
    .some((action: any) => action.type === "audio" && authorized.has(action.audioId));
  return audio ? null : "objective_audio_deadline_required: inclua o áudio autorizado do objetivo neste turno; limite de turnos atingido";
}
