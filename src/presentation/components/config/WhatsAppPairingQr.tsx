export function WhatsAppPairingQr({ dataUrl }: { dataUrl?: string | null }) {
  return <div className="space-y-3 text-center">
    {dataUrl ? <img src={dataUrl} alt="QR para conectar este WhatsApp" width={280} height={280} className="mx-auto h-auto w-full max-w-[280px] rounded-xl bg-white" /> :
      <p role="status" className="py-6 text-xs text-zinc-500">Preparando QR de conexão…</p>}
    <p className="text-xs leading-relaxed text-zinc-500">No segundo celular: WhatsApp → Dispositivos conectados → Conectar dispositivo. Escaneie este QR.</p>
  </div>;
}
