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

const STABLE_AVATAR_PREFIX = "/storage/v1/object/public/vendeo_vault/instagram_avatars/";

function isStableAvatarUrl(value: unknown): boolean {
  const url = String(value || "");
  return url.includes(STABLE_AVATAR_PREFIX);
}

function avatarExtension(contentType: string): string {
  const normalized = contentType.toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  return "jpg";
}

async function persistInstagramAvatar(
  supabase: any,
  avatarUrl: string,
  conversationId: string,
): Promise<string> {
  if (!avatarUrl || isStableAvatarUrl(avatarUrl)) return avatarUrl;

  const response = await fetch(avatarUrl, {
    signal: AbortSignal.timeout(10000),
    headers: { "User-Agent": "Vendeo/1.0" },
  });
  if (!response.ok) {
    throw new Error(`instagram_avatar_download_failed:${response.status}`);
  }

  const contentType = String(response.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  if (!contentType.startsWith("image/")) {
    throw new Error(`instagram_avatar_invalid_content_type:${contentType}`);
  }

  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > 8 * 1024 * 1024) {
    throw new Error(`instagram_avatar_invalid_size:${bytes.byteLength}`);
  }

  const safeConversationId = conversationId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const objectPath = `instagram_avatars/${safeConversationId}.${avatarExtension(contentType)}`;
  const { error: uploadError } = await supabase.storage
    .from("vendeo_vault")
    .upload(objectPath, bytes, {
      contentType,
      upsert: true,
      cacheControl: "86400",
    });

  if (uploadError) {
    throw new Error(`instagram_avatar_upload_failed:${uploadError.message}`);
  }

  const { data } = supabase.storage.from("vendeo_vault").getPublicUrl(objectPath);
  const publicUrl = String(data?.publicUrl || "");
  if (!publicUrl) throw new Error("instagram_avatar_public_url_missing");
  return publicUrl;
}

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

      const currentAvatar = String(currentConversation.avatar || "");
      const avatarNeedsMigration =
        Boolean(currentAvatar) &&
        currentAvatar !== "/images/default-avatar.svg" &&
        !isStableAvatarUrl(currentAvatar);
      const alreadyResolved =
        Boolean(currentConversation.username) &&
        !String(currentConversation.username).startsWith("ig_") &&
        isStableAvatarUrl(currentAvatar);

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
        update.avatar = await persistInstagramAvatar(
          params.supabase,
          resolved.avatar,
          job.conversation_id,
        );
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

      if (avatarNeedsMigration && !update.avatar) {
        if (Number(job.attempt_count || 0) >= 5) {
          await params.supabase
            .from("instagram_conversations")
            .update({
              avatar: "/images/default-avatar.svg",
              updated_at: new Date().toISOString(),
            })
            .eq("id", job.conversation_id);
          await completeProfileJob(params.supabase, workerToken, job.conversation_id);
          return;
        }
        await rescheduleProfileJob(
          params.supabase,
          workerToken,
          job,
          "instagram_avatar_not_resolved",
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
