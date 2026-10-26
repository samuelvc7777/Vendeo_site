function classifyPairingError(error) {
  const raw = String(error?.message || error);
  if (/56367|getStorage|storage_not_ready|WhatsApp Web ainda está iniciando|Execution context was destroyed|detached Frame|Target closed/i.test(raw)) {
    return { statusCode: 503, cooldownMs: 0, message: "O WhatsApp Web ainda não disponibilizou o armazenamento para gerar o código. Você pode conectar por QR ou aguardar e tentar por número novamente." };
  }
  if (/rate.?overlimit|iqerrorrateoverlimit|\b429\b/i.test(raw)) {
    return { statusCode: 429, cooldownMs: 15 * 60_000, message: "O WhatsApp informou um limite temporário de tentativas. Aguarde cerca de 15 minutos antes de gerar outro código." };
  }
  return { statusCode: 503, cooldownMs: 10_000, message: "Não foi possível gerar o código agora. Aguarde alguns segundos ou conecte usando QR." };
}

async function isPairingStorageReady(page) {
  return page.evaluate(() => {
    try {
      const socket = window.require("WAWebSocketModel").Socket.state;
      if (socket !== "UNPAIRED" && socket !== "UNPAIRED_IDLE") return false;
      return Boolean(window.require("WAWebModelStorageUtils").getStorage());
    } catch { return false; }
  });
}

module.exports = { classifyPairingError, isPairingStorageReady };
