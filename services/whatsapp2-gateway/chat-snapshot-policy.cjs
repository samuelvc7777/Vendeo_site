// O limite operacional vale para a caixa principal. Categorias especiais
// precisam continuar disponíveis, independentemente da idade das mensagens.
function limitChatSnapshot(rows, limit) {
  let regularCount = 0;
  return rows.filter(chat => chat.archived || chat.isLocked || regularCount++ < limit);
}

module.exports = { limitChatSnapshot };
