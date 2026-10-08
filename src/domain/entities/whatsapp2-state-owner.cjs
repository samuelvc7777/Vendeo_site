// A data da mensagem define a prévia, não qual alias possui o atendimento.
// As linhas recebidas devem pertencer à mesma identidade confirmada pelo WhatsApp.
function selectWhatsApp2StateOwner(rows) {
  const candidates = Array.isArray(rows) ? rows : [];
  function hasConfiguredState(row) {
    const rules = row?.stage_completed_rules || {};
    return Boolean(row?.current_stage_id || row?.ai_auto_respond
      || row?.autopilot_status || rules.status || rules.orchestration?.activation_watermark
      || rules.orchestration?.lastDecision);
  }
  return [...candidates].sort((a, b) => {
    const configuredDifference = Number(hasConfiguredState(b)) - Number(hasConfiguredState(a));
    if (configuredDifference) return configuredDifference;
    // Quando ambos têm atendimento, usa a identidade de telefone de forma
    // estável. Uma mensagem nova no LID não pode alternar o dono do estado.
    if (hasConfiguredState(a) && hasConfiguredState(b)) {
      const phoneDifference = Number(String(b.id).endsWith('@c.us')) - Number(String(a.id).endsWith('@c.us'));
      if (phoneDifference) return phoneDifference;
      return String(a.id).localeCompare(String(b.id));
    }
    return (Date.parse(b.last_message_at) || 0) - (Date.parse(a.last_message_at) || 0);
  })[0];
}
module.exports = { selectWhatsApp2StateOwner };
