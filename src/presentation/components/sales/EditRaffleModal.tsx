"use client";

import React, { useState, useEffect } from "react";
import {
  Calendar,
  Ticket,
  DollarSign,
  Tag,
  Trophy,
  Loader2,
  Trash2,
  AlertTriangle,
  Pencil,
  Image as ImageIcon,
} from "lucide-react";
import { Raffle, RaffleStatus } from "@/domain/entities/Raffle";
import { ResponsiveModal } from "@/presentation/components/ui/ResponsiveModal";

interface EditRaffleModalProps {
  isOpen: boolean;
  onClose: () => void;
  raffle: Raffle;
  onUpdate: (id: string, updates: Partial<Raffle>) => Promise<any>;
  onDelete: (id: string) => Promise<void>;
}

export function EditRaffleModal({
  isOpen,
  onClose,
  raffle,
  onUpdate,
  onDelete,
}: EditRaffleModalProps) {
  const [title, setTitle] = useState(raffle.title);
  const [description, setDescription] = useState(raffle.description || "");
  const [imageUrl, setImageUrl] = useState(
    raffle.imageUrl ||
      "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1000&q=80"
  );
  const [totalNumbers, setTotalNumbers] = useState<number>(raffle.totalNumbers);
  const [pricePerNumber, setPricePerNumber] = useState<number>(raffle.pricePerNumber);
  const [startDate, setStartDate] = useState<string>(
    raffle.startDate ? raffle.startDate.split("T")[0] : ""
  );
  const [endDate, setEndDate] = useState<string>(
    raffle.endDate ? raffle.endDate.split("T")[0] : ""
  );
  const [status, setStatus] = useState<RaffleStatus>(raffle.status);
  const [winningNumber, setWinningNumber] = useState<string>(
    raffle.winningNumber !== undefined && raffle.winningNumber !== null
      ? String(raffle.winningNumber)
      : ""
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setTitle(raffle.title);
    setDescription(raffle.description || "");
    setImageUrl(
      raffle.imageUrl ||
        "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1000&q=80"
    );
    setTotalNumbers(raffle.totalNumbers);
    setPricePerNumber(raffle.pricePerNumber);
    setStartDate(raffle.startDate ? raffle.startDate.split("T")[0] : "");
    setEndDate(raffle.endDate ? raffle.endDate.split("T")[0] : "");
    setStatus(raffle.status);
    setWinningNumber(
      raffle.winningNumber !== undefined && raffle.winningNumber !== null
        ? String(raffle.winningNumber)
        : ""
    );
    setErrorMessage(null);
  }, [raffle]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMessage("O título da rifa não pode ficar vazio.");
      return;
    }
    if (totalNumbers <= 0) {
      setErrorMessage("A quantidade de números deve ser maior que 0.");
      return;
    }
    if (pricePerNumber <= 0) {
      setErrorMessage("O valor por número deve ser maior que 0.");
      return;
    }

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      const updates: Partial<Raffle> = {
        title: title.trim(),
        description: description.trim(),
        imageUrl: imageUrl.trim() || undefined,
        totalNumbers,
        pricePerNumber,
        status,
        winningNumber: winningNumber !== "" ? Number(winningNumber) : null,
      };

      if (startDate) updates.startDate = new Date(startDate).toISOString();
      if (endDate) updates.endDate = new Date(endDate).toISOString();

      await onUpdate(raffle.id, updates);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || "Erro ao atualizar a rifa.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    const confirm = window.confirm(
      `ATENÇÃO: Deseja realmente EXCLUIR a rifa "${raffle.title}"?\n\nEsta ação removerá todos os bilhetes e registros de compra desta rifa!`
    );
    if (!confirm) return;

    try {
      setIsDeleting(true);
      setErrorMessage(null);
      await onDelete(raffle.id);
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || "Erro ao excluir a rifa.");
      setIsDeleting(false);
    }
  };

  return (
    <ResponsiveModal
      isOpen={isOpen}
      onClose={onClose}
      title="Editar Rifa"
      description="Atualize detalhes, datas, status ou exclua a rifa"
      maxWidth="lg"
      icon={
        <div className="w-9 h-9 rounded-xl bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] flex items-center justify-center text-zinc-600 dark:text-[#a8a8a8]">
          <Pencil className="w-4 h-4" />
        </div>
      }
    >
      {errorMessage && (
        <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-500 dark:text-red-400 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Título */}
        <div>
          <label className="block text-xs font-semibold text-zinc-800 dark:text-[#e5e5e5] mb-1.5">
            Título da Rifa / Prêmio *
          </label>
          <div className="relative">
            <Tag className="w-4 h-4 text-zinc-500 dark:text-[#737373] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              inputMode="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Rifa da Moto Honda Fan 160cc"
              className="w-full bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] rounded-xl pl-9 pr-3 py-3 text-sm text-zinc-950 dark:text-white placeholder-zinc-400 dark:placeholder-[#737373] focus:outline-none focus:border-[#0095f6] transition-colors"
              required
            />
          </div>
        </div>

        {/* Descrição */}
        <div>
          <label className="block text-xs font-semibold text-zinc-800 dark:text-[#e5e5e5] mb-1.5">
            Descrição / Regras
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Informações do sorteio, prêmio..."
            rows={2}
            className="w-full bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] rounded-xl px-3 py-2.5 text-sm text-zinc-950 dark:text-white placeholder-zinc-400 dark:placeholder-[#737373] focus:outline-none focus:border-[#0095f6] transition-colors resize-none"
          />
        </div>

        {/* Foto / Imagem do Prêmio */}
        <div>
          <label className="block text-xs font-semibold text-zinc-800 dark:text-[#e5e5e5] mb-1.5">
            Foto / Banner do Prêmio (URL)
          </label>
          <div className="flex gap-2 items-center mb-2">
            <div className="relative flex-1">
              <ImageIcon className="w-4 h-4 text-zinc-500 dark:text-[#737373] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="url"
                inputMode="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://exemplo.com/foto-moto.jpg"
                className="w-full bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] rounded-xl pl-9 pr-3 py-2.5 text-xs text-zinc-950 dark:text-white placeholder-zinc-400 dark:placeholder-[#737373] focus:outline-none focus:border-[#0095f6] transition-colors font-mono"
              />
            </div>
            {imageUrl && (
              <div className="w-11 h-11 rounded-xl overflow-hidden border border-zinc-300 dark:border-[#38383a] shrink-0 bg-zinc-50 dark:bg-black">
                <img
                  src={imageUrl}
                  alt="Preview"
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    (e.target as any).src =
                      "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1000&q=80";
                  }}
                />
              </div>
            )}
          </div>
          {/* Presets rápidos de fotos */}
          <div className="flex flex-wrap gap-1.5">
            {[
              {
                label: "🏍️ Moto 160",
                url: "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1000&q=80",
              },
              {
                label: "🚗 Carro",
                url: "https://images.unsplash.com/photo-1617814076367-b759c7d7e738?auto=format&fit=crop&w=1000&q=80",
              },
              {
                label: "📱 iPhone 15",
                url: "https://images.unsplash.com/photo-1695048133142-1a20484d2569?auto=format&fit=crop&w=1000&q=80",
              },
              {
                label: "💵 R$ 5.000 PIX",
                url: "https://images.unsplash.com/photo-1559526324-4b87b5e36e44?auto=format&fit=crop&w=1000&q=80",
              },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setImageUrl(p.url)}
                className="min-h-[36px] px-2.5 py-1.5 rounded-lg bg-white dark:bg-[#18181b] border border-zinc-200 dark:border-[#262626] text-xs text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white hover:border-zinc-400 dark:hover:border-[#38383a] active:scale-95 transition-all cursor-pointer"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Status da Rifa */}
        <div>
          <label className="block text-xs font-semibold text-zinc-800 dark:text-[#e5e5e5] mb-1.5">
            Status da Rifa
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[
              {
                id: "active",
                label: "Ativa",
                color:
                  "border-emerald-300 dark:border-emerald-500/50 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400",
              },
              {
                id: "paused",
                label: "Pausada",
                color:
                  "border-amber-300 dark:border-amber-500/50 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400",
              },
              {
                id: "drawn",
                label: "Sorteada",
                color:
                  "border-purple-300 dark:border-purple-500/50 bg-purple-50 dark:bg-purple-950/20 text-purple-700 dark:text-purple-400",
              },
            ].map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setStatus(s.id as RaffleStatus)}
                className={`min-h-[44px] py-2 px-2.5 rounded-xl border text-xs font-bold transition-all active:scale-95 cursor-pointer ${
                  status === s.id
                    ? `${s.color} ring-1 ring-zinc-300 dark:ring-white/20 shadow-sm`
                    : "bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] text-zinc-500 dark:text-[#737373] hover:text-zinc-950 dark:hover:text-white"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Número Sorteado */}
        {status === "drawn" && (
          <div className="p-3.5 rounded-2xl bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-500/30 space-y-1.5 animate-in fade-in duration-150">
            <label className="block text-xs font-bold text-purple-700 dark:text-purple-300">
              🏆 Número Sorteado / Vencedor
            </label>
            <div className="relative">
              <Trophy className="w-4 h-4 text-purple-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                value={winningNumber}
                onChange={(e) => setWinningNumber(e.target.value)}
                placeholder="Informe o número premiado (ex: 47)"
                className="w-full bg-white dark:bg-[#1c1c1e] border border-purple-500/40 rounded-xl pl-9 pr-3 py-2.5 text-sm text-zinc-950 dark:text-white placeholder-zinc-400 dark:placeholder-[#737373] focus:outline-none"
              />
            </div>
          </div>
        )}

        {/* Quantidade de Números & Valor por Cota */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-800 dark:text-[#e5e5e5] mb-1.5">
              Total de Cotas
            </label>
            <div className="relative">
              <Ticket className="w-4 h-4 text-zinc-500 dark:text-[#737373] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="number"
                inputMode="numeric"
                pattern="[0-9]*"
                min={10}
                max={5000}
                value={totalNumbers}
                onChange={(e) => setTotalNumbers(Number(e.target.value))}
                className="w-full bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] rounded-xl pl-9 pr-2 py-2.5 text-xs text-zinc-950 dark:text-white focus:outline-none focus:border-[#0095f6]"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-800 dark:text-[#e5e5e5] mb-1.5">
              Valor por Cota (R$)
            </label>
            <div className="relative">
              <DollarSign className="w-4 h-4 text-zinc-500 dark:text-[#737373] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="number"
                inputMode="decimal"
                step="0.50"
                min={1}
                value={pricePerNumber}
                onChange={(e) => setPricePerNumber(Number(e.target.value))}
                className="w-full bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] rounded-xl pl-9 pr-2 py-2.5 text-xs text-zinc-950 dark:text-white focus:outline-none focus:border-[#0095f6]"
                required
              />
            </div>
          </div>
        </div>

        {/* Datas */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-zinc-800 dark:text-[#e5e5e5] mb-1.5">
              Início
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-zinc-500 dark:text-[#737373] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] rounded-xl pl-9 pr-2 py-2.5 text-xs text-zinc-950 dark:text-white focus:outline-none focus:border-[#0095f6]"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-800 dark:text-[#e5e5e5] mb-1.5">
              Fim / Sorteio
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-zinc-500 dark:text-[#737373] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full bg-zinc-100 dark:bg-[#1c1c1e] border border-zinc-200 dark:border-[#262626] rounded-xl pl-9 pr-2 py-2.5 text-xs text-zinc-950 dark:text-white focus:outline-none focus:border-[#0095f6]"
              />
            </div>
          </div>
        </div>

        {/* Rodapé: Excluir e Salvar (Touch targets >= 44px) */}
        <div className="pt-4 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 border-t border-zinc-200 dark:border-[#262626]">
          <button
            type="button"
            disabled={isDeleting || isSubmitting}
            onClick={handleDelete}
            className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 dark:text-red-400 hover:bg-red-500/20 text-xs font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95 disabled:opacity-50 cursor-pointer"
          >
            {isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-4 h-4" />
            )}
            <span>Excluir Rifa</span>
          </button>

          <div className="flex items-center gap-2 justify-end">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] px-4 py-2.5 rounded-xl border border-zinc-200 dark:border-[#262626] text-xs font-medium text-zinc-600 dark:text-[#a8a8a8] hover:text-zinc-950 dark:hover:text-white hover:bg-zinc-100 dark:hover:bg-[#262626] active:scale-95 transition-all flex-1 sm:flex-none"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting || isDeleting}
              className="min-h-[44px] px-5 py-2.5 rounded-xl bg-[#0095f6] hover:bg-[#0081d6] text-white font-bold text-xs shadow-md shadow-[#0095f6]/20 active:scale-95 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50 flex-1 sm:flex-none cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Salvando...</span>
                </>
              ) : (
                "Salvar Alterações"
              )}
            </button>
          </div>
        </div>
      </form>
    </ResponsiveModal>
  );
}
