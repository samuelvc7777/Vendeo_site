async function resolveRaffleNumbersForFinalization({ supabase, requestedRaffleId }) {
  if (!supabase) throw new Error("Supabase indisponível para consultar números reais da rifa.");
  const { data, error } = await supabase.from("instagram_conversations")
    .select("stage_completed_rules").eq("id", "__raffle_data__").maybeSingle();
  if (error) throw error;
  const payload = data?.stage_completed_rules;
  const raffles = Array.isArray(payload?.raffles) ? payload.raffles : [];
  const raffle = requestedRaffleId ? raffles.find(item => item.id === requestedRaffleId) : raffles.find(item => item.status === "active");
  if (!raffle || raffle.status !== "active") throw new Error("Rifa ativa não encontrada para a finalização.");
  const total = Number(raffle.totalNumbers);
  if (!Number.isSafeInteger(total) || total < 1 || total > 100000) throw new Error("Quantidade de números da rifa inválida.");
  const tickets = Array.isArray(payload?.tickets?.[raffle.id]) ? payload.tickets[raffle.id] : [];
  const unavailable = new Set(tickets.filter(item => item.status === "paid" || item.status === "reserved").map(item => Number(item.number)));
  const available = [];
  for (let n = 1; n <= total; n++) if (!unavailable.has(n)) available.push(n);
  if (!available.length) throw new Error("Não há números disponíveis na rifa selecionada.");
  // É uma consulta: não expira reservas nem altera bilhetes.
  const width = Math.max(2, String(total - 1).length);
  return available.slice(0, 10).map(n => String(n).padStart(width, "0")).join(", ");
}

module.exports = { resolveRaffleNumbersForFinalization };
