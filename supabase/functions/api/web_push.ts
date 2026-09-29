import webpush from "npm:web-push@3.6.7";

export type CriticalPushEventType =
  | "manual_resolution_required"
  | "workflow_finalized";

type PushSubscriptionRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

type DispatchCriticalPushParams = {
  supabase: any;
  eventType: CriticalPushEventType;
  conversationId: string;
  eventKey: string;
  title?: string;
  body?: string;
};

function fallbackTitle(eventType: CriticalPushEventType, contactName: string) {
  return eventType === "manual_resolution_required"
    ? `Brain precisa de você • ${contactName}`
    : `Conversa finalizada • ${contactName}`;
}

function fallbackBody(eventType: CriticalPushEventType) {
  return eventType === "manual_resolution_required"
    ? "O Brain precisa de uma informação sua para continuar a conversa."
    : "Todos os objetivos foram concluídos. A IA foi desligada automaticamente neste chat.";
}

async function loadPushConfig(supabase: any) {
  const { data, error } = await supabase
    .from("web_push_runtime_config")
    .select("vapid_public_key, vapid_private_key, subject, enabled")
    .eq("id", "default")
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function getCriticalWebPushPublicConfig(supabase: any) {
  const config = await loadPushConfig(supabase);
  return {
    enabled: config?.enabled === true,
    publicKey: config?.enabled === true ? String(config.vapid_public_key || "") : "",
  };
}

export async function registerCriticalWebPushSubscription(
  supabase: any,
  subscription: any,
  userAgent?: string | null,
) {
  const endpoint = String(subscription?.endpoint || "").trim();
  const p256dh = String(subscription?.keys?.p256dh || "").trim();
  const auth = String(subscription?.keys?.auth || "").trim();
  if (!endpoint || !p256dh || !auth || endpoint.length > 4096 || p256dh.length > 512 || auth.length > 512) {
    throw new Error("invalid_push_subscription");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("web_push_subscriptions")
    .upsert({
      endpoint,
      p256dh,
      auth,
      user_agent: String(userAgent || "").slice(0, 1000) || null,
      enabled: true,
      failure_count: 0,
      last_error: null,
      updated_at: now,
      last_seen_at: now,
    }, { onConflict: "endpoint" });
  if (error) throw error;
  return { success: true };
}

export async function disableCriticalWebPushSubscription(supabase: any, endpoint: string) {
  const normalized = String(endpoint || "").trim();
  if (!normalized) return { success: true };
  const { error } = await supabase
    .from("web_push_subscriptions")
    .update({ enabled: false, updated_at: new Date().toISOString() })
    .eq("endpoint", normalized);
  if (error) throw error;
  return { success: true };
}

export async function dispatchCriticalWebPush(params: DispatchCriticalPushParams) {
  const {
    supabase,
    eventType,
    conversationId,
    eventKey,
  } = params;
  if (!eventKey || !conversationId) return { sent: 0, failed: 0, skipped: "invalid_event" };

  const { data: existingEvent } = await supabase
    .from("web_push_events")
    .select("id, dispatched_at")
    .eq("event_key", eventKey)
    .maybeSingle();
  if (existingEvent?.dispatched_at) {
    return { sent: 0, failed: 0, skipped: "duplicate" };
  }

  let eventId = existingEvent?.id || null;
  if (!eventId) {
    const { data: inserted, error: insertError } = await supabase
      .from("web_push_events")
      .insert({
        event_key: eventKey,
        event_type: eventType,
        conversation_id: conversationId,
        payload: {},
      })
      .select("id")
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        const { data: raced } = await supabase
          .from("web_push_events")
          .select("id, dispatched_at")
          .eq("event_key", eventKey)
          .maybeSingle();
        if (raced?.dispatched_at) return { sent: 0, failed: 0, skipped: "duplicate" };
        eventId = raced?.id || null;
      } else {
        throw insertError;
      }
    } else {
      eventId = inserted?.id || null;
    }
  }

  const [{ data: conversation }, config, subscriptionsResult] = await Promise.all([
    supabase
      .from("instagram_conversations")
      .select("full_name, username")
      .eq("id", conversationId)
      .maybeSingle()
      .then((result: any) => result),
    loadPushConfig(supabase),
    supabase
      .from("web_push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("enabled", true),
  ]);

  if (!config?.enabled || !config?.vapid_public_key || !config?.vapid_private_key) {
    return { sent: 0, failed: 0, skipped: "push_disabled" };
  }
  if (subscriptionsResult.error) throw subscriptionsResult.error;

  const subscriptions: PushSubscriptionRow[] = Array.isArray(subscriptionsResult.data)
    ? subscriptionsResult.data
    : [];
  const contactName =
    String(conversation?.full_name || conversation?.username || "Conversa do Instagram").trim();
  const title = params.title || fallbackTitle(eventType, contactName);
  const body = params.body || fallbackBody(eventType);
  const payload = JSON.stringify({
    eventType,
    title,
    body,
    conversationId,
    tag: eventType === "manual_resolution_required"
      ? `brain_manual_${conversationId}`
      : `workflow_finalized_${conversationId}`,
    requireInteraction: eventType === "manual_resolution_required",
  });

  webpush.setVapidDetails(
    String(config.subject || "https://vendeo-e755e.web.app"),
    String(config.vapid_public_key),
    String(config.vapid_private_key),
  );

  let sent = 0;
  let failed = 0;
  const now = new Date().toISOString();

  await Promise.all(subscriptions.map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      }, payload, { TTL: eventType === "manual_resolution_required" ? 3600 : 21600 });
      sent += 1;
      await supabase
        .from("web_push_subscriptions")
        .update({
          failure_count: 0,
          last_error: null,
          last_success_at: now,
          updated_at: now,
        })
        .eq("id", subscription.id);
    } catch (error: any) {
      failed += 1;
      const statusCode = Number(error?.statusCode || error?.status || 0);
      const terminal = statusCode === 404 || statusCode === 410;
      await supabase
        .from("web_push_subscriptions")
        .update({
          enabled: terminal ? false : true,
          failure_count: terminal ? 99 : 1,
          last_error: String(error?.body || error?.message || error || "push_failed").slice(0, 2000),
          last_failure_at: now,
          updated_at: now,
        })
        .eq("id", subscription.id);
    }
  }));

  if (eventId) {
    await supabase
      .from("web_push_events")
      .update({
        payload: { title, body, eventType, conversationId },
        dispatched_at: now,
        success_count: sent,
        failure_count: failed,
      })
      .eq("id", eventId);
  }

  return { sent, failed, skipped: subscriptions.length === 0 ? "no_subscriptions" : null };
}
