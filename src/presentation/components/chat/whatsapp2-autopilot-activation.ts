type ActivationMode = "immediate" | "wait_next";

export async function activateWhatsApp2Autopilot(
  mode: ActivationMode,
  prepare: () => Promise<{ latestInbound: boolean; persisted: boolean; conversationId?: string }>,
  activate: (mode: ActivationMode, conversationId?: string) => Promise<void>,
) {
  if (mode === "wait_next") return activate(mode);
  const snapshot = await prepare();
  if (snapshot.latestInbound && !snapshot.persisted) {
    throw new Error("A mensagem mais recente ainda não chegou ao histórico. Tente novamente em alguns segundos.");
  }
  // O histórico canônico pode estar atrasado em relação à resposta enviada no celular.
  return activate(snapshot.latestInbound ? "immediate" : "wait_next", snapshot.conversationId);
}
