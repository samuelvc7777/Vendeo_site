export type TinderAutopilotActivationMode = "immediate" | "wait_next";

type ApiFetch = (path: string, init: RequestInit) => Promise<Response>;

export async function activateTinderAutopilot(
  apiFetch: ApiFetch,
  mode: TinderAutopilotActivationMode,
  conversationId: string,
): Promise<{ immediateTriggered: boolean }> {
  const isImmediate = mode === "immediate";
  const response = await apiFetch(
    isImmediate ? "/api/autopilot/restart-chat" : "/api/autopilot/toggle-chat",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isImmediate
        ? { conversationId }
        : { conversationId, isEnabled: true, mode, triggerImmediate: false }),
    },
  );
  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.success !== true || result.isEnabled !== true) {
    throw new Error(result.detail || result.error || `HTTP ${response.status}`);
  }

  const immediateTriggered = isImmediate && Boolean(result.retryMessageId);
  if (immediateTriggered && result.queued !== true) {
    throw new Error(result.queueReason || "Não foi possível enfileirar a última mensagem pendente.");
  }

  return { immediateTriggered };
}
