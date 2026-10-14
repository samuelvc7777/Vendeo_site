/**
 * Indicador puramente operacional do despacho. Nao interpreta o conteudo do
 * Brain nem decide mensagens; reflete o status persistido de cada acao.
 */
export function outboxActivityLabel(statuses: string[]): string {
  if (statuses.length === 0) return "Aguardando nova mensagem";
  if (statuses.some((status) => status === "dispatch_uncertain")) return "Entrega incerta";
  if (statuses.some((status) => status === "failed" || status === "failed_confirmed")) return "Falha no envio";
  if (statuses.every((status) => status === "sent")) return "Brain respondeu";
  if (statuses.some((status) => status === "sending")) return "Enviando mensagens";
  if (statuses.some((status) => status === "failed_retryable")) return "Nova tentativa programada";
  if (statuses.some((status) => status === "pending" || status === "waiting_delay")) return "Aguardando envio";
  if (statuses.every((status) => status === "cancelled")) return "Envio cancelado";
  return "Aguardando envio";
}
