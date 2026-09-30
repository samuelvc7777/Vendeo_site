import { runBrainOrchestration } from "./brain_orchestrator.ts";
import { activity, publishAutoPilotState } from "./autopilot_state.ts";
import { resolveInboundAudioMessage } from "./audio_transcription.ts";
import { isActionableInboundMessage } from "./ConversationQualityGate.ts";
import { enqueueOpenAiConversationMessageSync } from "./openai_conversation_runtime.ts";

interface ClaimedInboundJob {
  conversation_id: string;
  latest_message_id: string;
  revision: number;
  attempt_count: number;
}

const retryAt = (seconds: number) =>
  new Date(Date.now() + Math.max(1, seconds) * 1000).toISOString();

async function completeJob(
  supabase: any,
  workerToken: string,
  job: ClaimedInboundJob,
) {
  return supabase.rpc("complete_autopilot_inbound_job", {
    p_conversation_id: job.conversation_id,
    p_worker_token: workerToken,
    p_claimed_revision: job.revision,
  });
}

async function rescheduleJob(
  supabase: any,
  workerToken: string,
  job: ClaimedInboundJob,
  dueAt: string,
  error?: unknown,
) {
  const message = error instanceof Error ? error.message : String(error || "");
  return supabase.rpc("reschedule_autopilot_inbound_job", {
    p_conversation_id: job.conversation_id,
    p_worker_token: workerToken,
    p_claimed_revision: job.revision,
    p_due_at: dueAt,
    p_last_error: message || null,
  });
}

async function persistInboundAudioToVault(
  supabase: any,
  message: any,
): Promise<any> {
  const mediaUrl = String(message?.media_url || "");
  const isMetaCdn =
    mediaUrl.includes("lookaside.fbsbx.com") ||
    mediaUrl.includes("cdninstagram.com");
  if (!mediaUrl || !isMetaCdn) return message;

  try {
    const audioRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(15_000) });
    if (!audioRes.ok) return message;

    const audioBytes = await audioRes.arrayBuffer();
    if (!audioBytes.byteLength) return message;

    const contentType = audioRes.headers.get("content-type") || "video/mp4";
    const safeId = String(message.id || crypto.randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "_");
    // Determinístico por message id: retry não cria objetos duplicados no Vault.
    const fileName = `inbound_voice_${safeId}.mp4`;
    const { data: upload, error: uploadError } = await supabase.storage
      .from("vendeo_vault")
      .upload(fileName, audioBytes, {
        contentType,
        upsert: true,
      });
    if (uploadError || !upload?.path) return message;

    const { data: publicData } = supabase.storage
      .from("vendeo_vault")
      .getPublicUrl(upload.path);
    const durableUrl = publicData?.publicUrl;
    if (!durableUrl) return message;

    const text = `[audio:${durableUrl}]`;
    await supabase
      .from("instagram_messages")
      .update({ media_url: durableUrl, text })
      .eq("id", message.id);

    return { ...message, media_url: durableUrl, text };
  } catch (error) {
    console.warn(
      `[Inbound Queue] Falha ao persistir áudio msg=${message?.id || "?"}:`,
      error,
    );
    return message;
  }
}

async function processClaimedInboundJob(
  supabase: any,
  workerToken: string,
  job: ClaimedInboundJob,
): Promise<void> {
  try {
    const { data: context, error: contextError } = await supabase.rpc(
      "get_autopilot_inbound_job_context",
      {
        p_conversation_id: job.conversation_id,
        p_message_id: job.latest_message_id,
      },
    );

    if (contextError || !context?.message || !context?.conversation) {
      await rescheduleJob(
        supabase,
        workerToken,
        job,
        retryAt(15),
        contextError || "inbound_job_context_missing",
      );
      return;
    }

    const config = context.config || {};
    const conversation = context.conversation || {};
    const state = context.state || {};
    let message = context.message || {};

    if (config?.isEnabledGlobally === false || config?.mode === "manual") {
      await rescheduleJob(supabase, workerToken, job, retryAt(60), "autopilot_global_paused");
      return;
    }

    const canonicalStatus = state?.status || null;
    const isPaused =
      conversation?.ai_auto_respond !== true ||
      state?.is_enabled === false ||
      conversation?.is_restricted === true ||
      canonicalStatus === "waiting_human" ||
      canonicalStatus === "paused_handoff" ||
      canonicalStatus === "paused_guardrail";

    if (isPaused || message?.is_mine === true) {
      await completeJob(supabase, workerToken, job);
      return;
    }

    if (message?.media_type === "audio") {
      message = await persistInboundAudioToVault(supabase, message);
    }

    const resolvedAudio = await resolveInboundAudioMessage(supabase, message);
    if (resolvedAudio.isAudio) {
      try {
        await enqueueOpenAiConversationMessageSync({
          supabase,
          conversationId: job.conversation_id,
          providerMessageId: job.latest_message_id,
          direction: "inbound",
          receivedAt: message.timestamp || message.created_at || new Date().toISOString(),
        });
      } catch (syncQueueError) {
        console.warn(
          `[Inbound Queue] Falha ao enfileirar sync OpenAI msg=${job.latest_message_id}:`,
          syncQueueError,
        );
      }
    }

    const inputText = resolvedAudio.isAudio
      ? resolvedAudio.text
      : String(message?.text || "");

    const actionable = isActionableInboundMessage({
      text: inputText,
      mediaType: resolvedAudio.isAudio ? "audio" : message?.media_type,
      audioTranscript: resolvedAudio.transcript,
    });

    if (!actionable) {
      await completeJob(supabase, workerToken, job);
      return;
    }

    const responseDelayMinutes = Number(config?.responseDelayMinutes);
    const maxDebounceWindowMinutes = Number(config?.maxDebounceWindowMinutes);
    if (
      !Number.isFinite(responseDelayMinutes) ||
      responseDelayMinutes < 0 ||
      !Number.isFinite(maxDebounceWindowMinutes) ||
      maxDebounceWindowMinutes < responseDelayMinutes
    ) {
      await rescheduleJob(
        supabase,
        workerToken,
        job,
        retryAt(30),
        "autopilot_timing_config_invalid",
      );
      return;
    }

    if (responseDelayMinutes > 0) {
      const { data: timingGate, error: timingError } = await supabase.rpc(
        "enforce_autopilot_response_delay_atomic",
        {
          p_conversation_id: job.conversation_id,
          p_quiet_seconds: Math.round(responseDelayMinutes * 60),
          p_max_window_seconds: Math.round(maxDebounceWindowMinutes * 60),
          p_now: new Date().toISOString(),
        },
      );

      if (timingError || timingGate?.success !== true) {
        await rescheduleJob(
          supabase,
          workerToken,
          job,
          retryAt(15),
          timingError || "response_delay_gate_failed",
        );
        return;
      }

      if (timingGate?.due_now !== true) {
        const scheduledAt = String(timingGate?.scheduled_at || "");
        if (!scheduledAt) {
          await rescheduleJob(supabase, workerToken, job, retryAt(15), "delay_schedule_missing");
          return;
        }

        await publishAutoPilotState(supabase, job.conversation_id, {
          status: "scheduled",
          activity: activity(
            "scheduled",
            `Aguardando tempo de resposta (${responseDelayMinutes}m)...`,
            "Aguardando o quiet period configurado antes de iniciar o Brain.",
            {
              scheduledAt,
              quietPeriodMinutes: responseDelayMinutes,
              maxDebounceWindowMinutes,
              event: "queued_authoritative_response_delay",
            },
          ),
          scheduledResponseAt: scheduledAt,
        });

        await rescheduleJob(supabase, workerToken, job, scheduledAt);
        return;
      }
    }

    const result = await runBrainOrchestration({
      supabase,
      conversationId: job.conversation_id,
      responseDelayMinutes,
      maxDebounceWindowMinutes,
      newMessage: {
        id: message.id,
        text: inputText,
        timestamp: message.timestamp || message.created_at || new Date().toISOString(),
        sender: message.sender_id || "them",
        mediaType: resolvedAudio.isAudio ? "audio" : (message.media_type || undefined),
        audioTranscript: resolvedAudio.hasValidTranscript
          ? resolvedAudio.transcript || undefined
          : undefined,
      },
    });

    const delayTrace = Array.isArray(result?.trace)
      ? result.trace.find((item: unknown) =>
          typeof item === "string" && item.startsWith("response_delay_enforced: scheduled_at=")
        )
      : null;
    if (delayTrace) {
      const scheduledAt = String(delayTrace).split("scheduled_at=")[1]?.trim();
      await rescheduleJob(
        supabase,
        workerToken,
        job,
        scheduledAt || retryAt(15),
        "response_delay_rechecked",
      );
      return;
    }

    if (result?.handled === true) {
      await completeJob(supabase, workerToken, job);
      return;
    }

    const errorCode = String(result?.error || "brain_not_handled");
    if (
      errorCode === "Lock ativo concorrente" ||
      errorCode === "global_capacity_busy" ||
      errorCode === "brain_capacity_unavailable"
    ) {
      // A preempção já foi marcada transacionalmente durante a admissão da
      // inbound. Aqui apenas devolvemos o job para a fila, sem incrementar
      // inboundRevision novamente.
      await rescheduleJob(supabase, workerToken, job, retryAt(5), errorCode);
      return;
    }

    if (errorCode === "technical_retry_exhausted") {
      await completeJob(supabase, workerToken, job);
      return;
    }

    const backoffSeconds = Math.min(
      300,
      Math.max(10, 10 * Math.pow(2, Math.min(Number(job.attempt_count || 1) - 1, 4))),
    );
    await rescheduleJob(
      supabase,
      workerToken,
      job,
      retryAt(backoffSeconds),
      errorCode,
    );
  } catch (error) {
    const backoffSeconds = Math.min(
      300,
      Math.max(15, 15 * Math.pow(2, Math.min(Number(job.attempt_count || 1) - 1, 4))),
    );
    console.error(
      `[Inbound Queue] Falha conv=${job.conversation_id} msg=${job.latest_message_id}:`,
      error,
    );
    await rescheduleJob(supabase, workerToken, job, retryAt(backoffSeconds), error);
  }
}

export async function processAutopilotInboundQueue(params: {
  supabase: any;
  limit?: number;
}): Promise<{ claimed: number }> {
  const limit = Math.max(1, Math.min(6, Number(params.limit || 3)));
  const workerToken = `inbound_${crypto.randomUUID()}`;

  const { data: claimed, error: claimError } = await params.supabase.rpc(
    "claim_autopilot_inbound_jobs",
    {
      p_worker_token: workerToken,
      p_limit: limit,
      p_lease_seconds: 240,
    },
  );

  if (claimError) {
    throw new Error(`autopilot_inbound_claim_failed: ${claimError.message}`);
  }

  const jobs = (claimed || []) as ClaimedInboundJob[];
  if (jobs.length === 0) return { claimed: 0 };

  const work = Promise.allSettled(
    jobs.map((job) => processClaimedInboundJob(params.supabase, workerToken, job)),
  );

  if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
    (globalThis as any).EdgeRuntime.waitUntil(work);
  } else {
    await work;
  }

  return { claimed: jobs.length };
}
