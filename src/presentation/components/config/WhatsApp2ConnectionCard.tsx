"use client";

import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2, MessageCircle, Smartphone } from "lucide-react";
import { toast } from "sonner";
import {
  disconnectWhatsApp2,
  getWhatsApp2Status,
  requestWhatsApp2PairingCode,
} from "@/presentation/components/chat/whatsapp2-client";
import { ResponsiveModal } from "@/presentation/components/ui/ResponsiveModal";

interface WhatsApp2ConnectionCardProps {
  onConnectionChange?: (connected: boolean) => void;
}

export function WhatsApp2ConnectionCard({ onConnectionChange }: WhatsApp2ConnectionCardProps) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getWhatsApp2Status>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [phone, setPhone] = useState("");
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [requestingCode, setRequestingCode] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [isDisconnectModalOpen, setIsDisconnectModalOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const next = await getWhatsApp2Status();
      setStatus(next);
      setError(null);
      if (next.pairingPhone) setPhone(next.pairingPhone);
      setPairingCode(next.pairingCode || null);
      const connected = next.status === "ready";
      onConnectionChange?.(connected);
      if (connected) setShowConnect(false);
    } catch (err) {
      setError((err as Error).message || "Gateway do WhatsApp indisponível.");
      onConnectionChange?.(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const connected = status?.status === "ready";

  const requestCode = async () => {
    const normalized = phone.replace(/\D/g, "");
    if (normalized.length < 8 || normalized.length > 15) {
      setError("Informe o número com código do país e DDD.");
      return;
    }

    setRequestingCode(true);
    setError(null);
    try {
      const result = await requestWhatsApp2PairingCode(normalized);
      setPhone(result.phoneNumber);
      setPairingCode(result.code);
      setStatus((current) => current ? {
        ...current,
        status: "pairing_code",
        pairingCode: result.code,
        pairingPhone: result.phoneNumber,
        pairingUpdatedAt: result.updatedAt,
        pairingExpiresAt: result.expiresAt,
      } : {
        ok: true,
        status: "pairing_code",
        pairingCode: result.code,
        pairingPhone: result.phoneNumber,
        pairingUpdatedAt: result.updatedAt,
        pairingExpiresAt: result.expiresAt,
      });
    } catch (err) {
      setError((err as Error).message || "Não foi possível gerar o código.");
    } finally {
      setRequestingCode(false);
    }
  };

  const confirmDisconnect = async () => {
    setIsDisconnectModalOpen(false);
    setDisconnecting(true);
    setError(null);
    try {
      await disconnectWhatsApp2();
      setStatus((current) => current ? {
        ...current,
        status: "disconnected",
        readyAt: null,
        me: null,
        pairingCode: null,
        pairingPhone: null,
      } : { ok: true, status: "disconnected", me: null });
      setPairingCode(null);
      setPhone("");
      setShowConnect(true);
      onConnectionChange?.(false);
      toast.success("WhatsApp desconectado.");
      window.setTimeout(() => void refresh(), 1200);
    } catch (err) {
      const message = (err as Error).message || "Não foi possível desconectar o WhatsApp.";
      setError(message);
      toast.error(message);
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <article className="min-w-0 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-[#262626] dark:bg-[#111113] sm:p-5">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#25d366]">
            <MessageCircle className="h-5 w-5 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-zinc-950 dark:text-white">WhatsApp</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">Dispositivo vinculado pelo WhatsApp Web</p>
          </div>
        </div>

        {loading && !status ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-100 px-2.5 py-1 text-[10px] text-zinc-600 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
            <Loader2 className="h-3 w-3 animate-spin" />
            Verificando
          </span>
        ) : connected ? (
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-emerald-200 bg-white/80 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-emerald-700 shadow-sm dark:border-emerald-500/25 dark:bg-emerald-500/10 dark:text-emerald-300">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
            Conectado
          </span>
        ) : (
          <span className="inline-flex shrink-0 items-center rounded-full border border-zinc-200 bg-white/80 px-2.5 py-1 text-[9px] font-black uppercase tracking-wide text-zinc-500 shadow-sm dark:border-white/10 dark:bg-white/5 dark:text-zinc-400">
            {error ? "Indisponível" : "Desconectado"}
          </span>
        )}
      </div>

      <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800/80">
        {connected ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-2xl border border-emerald-200/80 bg-emerald-50/70 p-3 dark:border-emerald-500/15 dark:bg-emerald-500/[0.06]">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#25d366]/15 text-[#008069] dark:text-[#25d366]">
                <Smartphone className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-zinc-950 dark:text-white">
                  {status?.me?.pushname || "WhatsApp conectado"}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                  {String(status?.me?.wid || "").replace("@c.us", "")}
                  {status?.me?.platform ? " · " + status.me.platform : ""}
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsDisconnectModalOpen(true)}
              disabled={disconnecting}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 text-xs font-bold text-red-700 transition hover:bg-red-100 active:scale-[0.99] disabled:opacity-50 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300 dark:hover:bg-red-500/15"
            >
              {disconnecting && <Loader2 className="h-4 w-4 animate-spin" />}
              {disconnecting ? "Desconectando..." : "Desconectar WhatsApp"}
            </button>
          </div>
        ) : !showConnect ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-400 sm:max-w-md">
              Conecte como dispositivo vinculado usando número e código de 8 caracteres, sem QR.
            </p>
            <button
              type="button"
              onClick={() => {
                setShowConnect(true);
                setError(null);
              }}
              className="min-h-11 w-full rounded-xl bg-[#00a884] px-4 text-xs font-bold text-white transition active:scale-[0.98] sm:w-auto"
            >
              Conectar WhatsApp
            </button>
          </div>
        ) : (
          <div className="space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 dark:border-white/10 dark:bg-white/[0.03]">
            <div>
              <p className="text-xs font-bold text-zinc-950 dark:text-white">Conectar por número</p>
              <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">Informe país + DDD + número. Exemplo: 5537999999999.</p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value);
                  setError(null);
                }}
                placeholder="5537999999999"
                className="min-h-11 min-w-0 flex-1 rounded-xl border border-zinc-200 bg-white px-3 text-[16px] md:text-xs text-zinc-950 outline-none transition focus:border-[#00a884] dark:border-white/10 dark:bg-[#18181b] dark:text-white"
              />
              <button
                type="button"
                onClick={() => void requestCode()}
                disabled={requestingCode}
                className="min-h-11 rounded-xl bg-[#00a884] px-4 text-xs font-bold text-white transition active:scale-[0.98] disabled:opacity-50"
              >
                {requestingCode ? "Gerando..." : "Gerar código"}
              </button>
            </div>

            {error && <p className="text-[11px] font-medium text-red-500">{error}</p>}

            {pairingCode && (
              <div className="rounded-xl border border-[#00a884]/20 bg-[#00a884]/5 p-3 text-center">
                <p className="text-[9px] font-black uppercase tracking-[0.16em] text-[#008069] dark:text-[#25d366]">Código de conexão</p>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(pairingCode);
                    toast.success("Código copiado para a área de transferência!");
                  }}
                  className="mt-1 font-mono text-[26px] font-black tracking-[0.18em] text-zinc-950 dark:text-white active:scale-95 transition-transform"
                  title="Toque para copiar código"
                >
                  {pairingCode.replace(/(.{4})(?=.)/g, "$1-")}
                </button>
                <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
                  No celular: WhatsApp → Dispositivos conectados → Conectar dispositivo → Conectar com número de telefone.
                </p>
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setShowConnect(false);
                setPairingCode(null);
                setError(null);
              }}
              className="min-h-10 w-full rounded-xl border border-zinc-200 bg-white text-xs font-semibold text-zinc-600 dark:border-white/10 dark:bg-white/5 dark:text-zinc-300"
            >
              Cancelar
            </button>
          </div>
        )}
      </div>

      {/* Modal de Confirmação Responsivo para Desconectar */}
      <ResponsiveModal
        isOpen={isDisconnectModalOpen}
        onClose={() => setIsDisconnectModalOpen(false)}
        maxWidth="sm"
        title="Desconectar WhatsApp?"
        description="O dispositivo vinculado será encerrado neste Vendeo."
        icon={
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-500/10 dark:text-red-400">
            <AlertTriangle className="h-5 w-5" />
          </div>
        }
        footer={
          <div className="flex w-full gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setIsDisconnectModalOpen(false)}
              className="min-h-11 flex-1 sm:flex-initial rounded-xl border border-zinc-200 dark:border-white/10 bg-white dark:bg-white/5 px-4 text-xs font-semibold text-zinc-700 dark:text-zinc-200"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void confirmDisconnect()}
              className="min-h-11 flex-1 sm:flex-initial rounded-xl bg-red-600 px-4 text-xs font-bold text-white shadow-sm hover:bg-red-700 active:scale-95"
            >
              Sim, desconectar
            </button>
          </div>
        }
      >
        <div className="text-xs text-zinc-600 dark:text-zinc-400 space-y-2 py-1">
          <p>
            Ao desconectar, o envio e recebimento de mensagens pelo WhatsApp 2 serão interrompidos até que uma nova sessão seja conectada.
          </p>
          <p className="text-[11px] text-zinc-500">
            Suas conversas e contatos salvos no Vendeo permanecerão intactos.
          </p>
        </div>
      </ResponsiveModal>
    </article>
  );
}
