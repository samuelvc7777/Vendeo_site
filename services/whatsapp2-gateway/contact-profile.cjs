function failure(message, statusCode) {
  return Object.assign(new Error(message), { statusCode });
}

async function contactProfile({ input, action, ensureReady, identity, blockedIds, setBlocked, prepare }) {
  const { chatId, phone } = input;
  if (typeof chatId !== "string" || !/^\d{1,30}(?:-\d{1,20})?@(?:c\.us|g\.us|lid)$/.test(chatId) ||
      typeof phone !== "string" || !/^\d{7,16}$/.test(phone)) {
    throw failure("Conversa ou conta inválida.", 400);
  }
  const active = ensureReady();
  const verifyAccount = () => {
    if (ensureReady() !== active || identity() !== phone) {
      throw failure("A conta do WhatsApp mudou. Reabra a conversa.", 409);
    }
  };
  verifyAccount();
  const chat = await active.getChatById(chatId);
  if (!chat) throw failure("Conversa não encontrada.", 404);
  verifyAccount();

  switch (action) {
    case null:
      return readProfile();
    case "mute":
    case "unmute": {
      const muted = action === "mute";
      const hours = input.hours;
      if (muted && ![0, 8, 168].includes(hours)) {
        throw failure("Duração de silêncio inválida.", 400);
      }
      const result = muted
        ? await chat.mute(hours === 0 ? undefined : new Date(Date.now() + hours * 3600000))
        : await chat.unmute();
      if (result?.isMuted !== muted) throw failure("O WhatsApp não confirmou a alteração.", 502);
      return { isMuted: muted };
    }
    case "block":
    case "unblock":
      if (chat.isGroup) throw failure("Selecione uma conversa individual.", 400);
      return setBlocked(chatId, action === "block", verifyAccount);
    case "leave":
      if (!chat.isGroup) throw failure("Selecione um grupo.", 400);
      await chat.leave();
      return { left: true };
    case "report": {
      await prepare();
      verifyAccount();
      const report = await active.pupPage.evaluate(
        (id, group) => globalThis.WPP.contact.reportContact(id, group ? "GroupInfoReport" : "ChatInfoReport"),
        chatId, chat.isGroup,
      );
      if (!report?.reportId || report.errorCode) throw failure("O WhatsApp não confirmou a denúncia.", 502);
      return { reported: true };
    }
    default:
      throw failure("Ação de perfil inválida.", 400);
  }

  async function readProfile() {
    const optional = (read) => Promise.resolve().then(read).catch(() => null);
    const [about, isBlocked, groups] = await Promise.all([
      chat.isGroup ? chat.description : optional(async () => (await chat.getContact())?.getAbout()),
      chat.isGroup ? null : optional(async () => (await blockedIds(active)).has(chatId)),
      chat.isGroup ? null : optional(async () => {
        const ids = await active.getCommonGroups(chatId);
        const titles = new Map((await active.getChats()).map(item => [item.id?._serialized, item.name]));
        return ids.map(id => titles.get(id._serialized) || id._serialized).filter(Boolean);
      }),
    ]);
    verifyAccount();
    const participants = chat.isGroup ? (chat.participants || []).map(member => ({
      id: member.id?._serialized,
      admin: Boolean(member.isAdmin || member.isSuperAdmin),
    })).filter(member => member.id) : null;
    return { about: about ?? null, isBlocked, isMuted: Boolean(chat.isMuted), groups, participants };
  }
}

module.exports = { contactProfile };
