interface InstagramProfileJob {
  conversation_id: string;
  raw_contact_id: string;
  message_id?: string | null;
  attempt_count: number;
}

interface ResolvedInstagramProfile {
  username: string;
  fullName: string;
  avatar: string;
  threadId?: string | null;
  igsid?: string | null;
}

type ResolveInstagramProfile = (
  supabase: any,
  accessToken: string,
  myUsername: string,
  conversationId: string,
  mid?: string | null,
) => Promise<ResolvedInstagramProfile>;

const retryAt = (seconds: number) =>
  new Date(Date.now() + Math.max(1, seconds) * 1000).toISOString();

async function completeProfileJob(
  supabase: any,
  workerToken: string,
  conversationId: string,
) {
  return supabase.rpc("complete_instagram_profile_job", {
    p_conversation_id: conversationId,
    p_worker_token: workerToken,
  });
}

async function rescheduleProfileJob(
  supabase: any,
  workerToken: string,
  job: InstagramProfileJob,
  error: unknown,
) {
  const attempts = Math.max(1, Number(job.attempt_count || 1));
  const backoffSeconds = Math.min(6 * 60 * 60, 60 * Math.pow(2, Math.min(attempts - 1, 8)));
  const message = error instanceof Error ? error.message : String(error || "profile_not_resolved");

  return supabase.rpc("reschedule_instagram_profile_job", {
    p_conversation_id: job.conversation_id,
    p_worker_token: workerToken,
    p_due_at: retryAt(backoffSeconds),
    p_last_error: message,
  });
}

export async function processInstagramProfileQueue(params: {
  supabase: any;
  resolveProfile: ResolveInstagramProfile;
  limit?: number;
}): Promise<{ claimed: number }> {
  const limit = Math.max(1, Math.min(4, Number(params.limit || 2)));
  const workerToken = `profile_${crypto.randomUUID()}`;

  const { data: claimed, error: claimError } = await params.supabase.rpc(
    "claim_instagram_profile_jobs",
    {
      p_worker_token: workerToken,
      p_limit: limit,
      p_lease_seconds: 120,
    },
  );

  if (claimError) {
    throw new Error(`instagram_profile_claim_failed: ${claimError.message}`);
  }

  const jobs = (claimed || []) as InstagramProfileJob[];
  if (jobs.length === 0) return { claimed: 0 };

  const { data: config, error: configError } = await params.supabase
    .from("instagram_config")
    .select("access_token, username")
    .eq("id", "default")
    .maybeSingle();

  if (configError || !config?.access_token) {
    await Promise.allSettled(
      jobs.map((job) =>
        rescheduleProfileJob(
          params.supabase,
          workerToken,
          job,
          configError || "instagram_access_token_unavailable",
        )
      ),
    );
    return { claimed: jobs.length };
  }

  const myUsername = String(config.username || "lariresende_0611");

  const work = jobs.map(async (job) => {
    try {
      const { data: currentConversation, error: currentError } = await params.supabase
        .from("instagram_conversations")
        .select("username, full_name, avatar")
        .eq("id", job.conversation_id)
        .maybeSingle();

      if (currentError || !currentConversation) {
        await rescheduleProfileJob(
          params.supabase,
          workerToken,
          job,
          currentError || "conversation_missing",
        );
        return;
      }

      const alreadyResolved =
        Boolean(currentConversation.username) &&
        !String(currentConversation.username).startsWith("ig_") &&
        Boolean(currentConversation.avatar) &&
        currentConversation.avatar !== "/images/default-avatar.svg";

      if (alreadyResolved) {
        await completeProfileJob(params.supabase, workerToken, job.conversation_id);
        return;
      }

      const resolved = await params.resolveProfile(
        params.supabase,
        String(config.access_token),
        myUsername,
        job.conversation_id,
        job.message_id || null,
      );

      const update: Record<string, unknown> = {};
      if (resolved.username && !resolved.username.startsWith("ig_")) {
        update.username = resolved.username;
        update.full_name = resolved.fullName || resolved.username;
      }
      if (
        resolved.avatar &&
        !resolved.avatar.includes("default-avatar.svg")
      ) {
        update.avatar = resolved.avatar;
      }
      if (resolved.igsid) {
        update.contact_id = resolved.igsid;
      }

      if (Object.keys(update).length === 0) {
        await rescheduleProfileJob(
          params.supabase,
          workerToken,
          job,
          "instagram_profile_not_resolved",
        );
        return;
      }

      update.updated_at = new Date().toISOString();
      const { error: updateError } = await params.supabase
        .from("instagram_conversations")
        .update(update)
        .eq("id", job.conversation_id);

      if (updateError) {
        await rescheduleProfileJob(
          params.supabase,
          workerToken,
          job,
          updateError,
        );
        return;
      }

      await completeProfileJob(params.supabase, workerToken, job.conversation_id);
    } catch (error) {
      await rescheduleProfileJob(params.supabase, workerToken, job, error);
    }
  });

  const settled = Promise.allSettled(work);
  if (typeof (globalThis as any).EdgeRuntime?.waitUntil === "function") {
    (globalThis as any).EdgeRuntime.waitUntil(settled);
  } else {
    await settled;
  }

  return { claimed: jobs.length };
}
