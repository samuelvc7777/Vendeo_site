"use client";

import React, { useState } from "react";
import { X, Calendar, Ticket, DollarSign, Tag, Sparkles, Loader2 } from "lucide-react";
import { CreateRaffleInput } from "@/domain/repositories/IRaffleRepository";

interface CreateRaffleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateRaffleInput) => Promise<any>;
}

export function CreateRaffleModal({
  isOpen,
  onClose,
  onSubmit,
}: CreateRaffleModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState(
    "https://images.unsplash.com/photo-1558981403-c5f9899a28bc?auto=format&fit=crop&w=1000&q=80"
  );
  const [totalNumbers, setTotalNumbers] = useState<number>(100);
  const [pricePerNumber, setPricePerNumber] = useState<number>(15);
  const [startDate, setStartDate] = useState<string>(
    new Date().toISOString().split("T")[0]
  );
  const [endDate, setEndDate] = useState<string>(
    new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0]
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setErrorMessage("Por favor, insira o título da rifa.");
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
      await onSubmit({
        title: title.trim(),
        description: description.trim(),
        imageUrl: imageUrl.trim() || undefined,
        totalNumbers,
        pricePerNumber,
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate).toISOString(),
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || "Erro ao criar nova rifa.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const presetCounts = [50, 100, 200, 500, 1000];

  return (
    <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/80 backdrop-blur-sm p-0 sm:p-4">
      <div
        className="w-full max-w-lg bg-[#121212] border border-[#262626] rounded-t-2xl sm:rounded-2xl p-5 text-white flex flex-col max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-150"
        role="dialog"
        aria-modal="true"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-[#262626]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-amber-500/20 to-yellow-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Cadastrar Nova Rifa</h2>
              <p className="text-xs text-[#a8a8a8]">
                Configure os números, prêmio e datas de vigência
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#737373] hover:text-white hover:bg-[#262626] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {errorMessage && (
          <div className="mt-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-xs text-red-400">
            {errorMessage}
          </div>
        )}

        {/* Formulário */}
        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          {/* Título */}
          <div>
            <label className="block text-xs font-semibold text-[#e5e5e5] mb-1.5">
              Título da Rifa / Prêmio *
            </label>
            <div className="relative">
              <Tag className="w-4 h-4 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Ex: Rifa da Moto Honda Fan 160cc ou iPhone 15"
                className="w-full bg-[#1c1c1e] border border-[#262626] rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-[#737373] focus:outline-none focus:border-[#0095f6] transition-colors"
                required
              />
            </div>
          </div>

          {/* Descrição */}
          <div>
            <label className="block text-xs font-semibold text-[#e5e5e5] mb-1.5">
              Descrição / Regras do Sorteio
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descreva os detalhes, prêmio extra para maior comprador, data estimada..."
              rows={2}
              className="w-full bg-[#1c1c1e] border border-[#262626] rounded-xl px-3 py-2 text-sm text-white placeholder-[#737373] focus:outline-none focus:border-[#0095f6] transition-colors resize-none"
            />
          </div>

          {/* Foto / Imagem do Prêmio */}
          <div>
            <label className="block text-xs font-semibold text-[#e5e5e5] mb-1.5">
              Foto / Banner do Prêmio (URL)
            </label>
            <div className="flex gap-2 items-center mb-2">
              <input
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://exemplo.com/foto-moto.jpg"
                className="w-full bg-[#1c1c1e] border border-[#262626] rounded-xl px-3 py-2 text-xs text-white placeholder-[#737373] focus:outline-none focus:border-[#0095f6] transition-colors font-mono"
              />
              {imageUrl && (
                <div className="w-10 h-10 rounded-lg overflow-hidden border border-[#38383a] shrink-0 bg-black">
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
                  className="px-2 py-1 rounded-md bg-[#18181b] border border-[#262626] text-[10px] text-[#a8a8a8] hover:text-white hover:border-[#38383a] transition-all"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Quantidade de Números */}
          <div>
            <label className="block text-xs font-semibold text-[#e5e5e5] mb-1.5">
              Quantidade de Números (Cotas) *
            </label>
            <div className="flex flex-wrap gap-2 mb-2">
              {presetCounts.map((count) => (
                <button
                  key={count}
                  type="button"
                  onClick={() => setTotalNumbers(count)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                    totalNumbers === count
                      ? "bg-[#0095f6] border-[#0095f6] text-white shadow-sm"
                      : "bg-[#1c1c1e] border-[#262626] text-[#a8a8a8] hover:text-white hover:border-[#38383a]"
                  }`}
                >
                  {count} cotas
                </button>
              ))}
            </div>
            <div className="relative">
              <Ticket className="w-4 h-4 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="number"
                min={10}
                max={5000}
                value={totalNumbers}
                onChange={(e) => setTotalNumbers(Number(e.target.value))}
                className="w-full bg-[#1c1c1e] border border-[#262626] rounded-xl pl-9 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#0095f6] transition-colors"
                required
              />
            </div>
          </div>

          {/* Valor por Cota */}
          <div>
            <label className="block text-xs font-semibold text-[#e5e5e5] mb-1.5">
              Valor por Cota (R$) *
            </label>
            <div className="relative">
              <DollarSign className="w-4 h-4 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="number"
                step="0.50"
                min={1}
                value={pricePerNumber}
                onChange={(e) => setPricePerNumber(Number(e.target.value))}
                className="w-full bg-[#1c1c1e] border border-[#262626] rounded-xl pl-9 pr-3 py-2.5 text-sm text-white focus:outline-none focus:border-[#0095f6] transition-colors"
                required
              />
            </div>
            <p className="mt-1 text-[11px] text-[#737373]">
              Arrecadação potencial máxima:{" "}
              <span className="font-semibold text-emerald-400">
                {(totalNumbers * pricePerNumber).toLocaleString("pt-BR", {
                  style: "currency",
                  currency: "BRL",
                })}
              </span>
            </p>
          </div>

          {/* Datas de Início e Fim */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-[#e5e5e5] mb-1.5">
                Data de Início
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full bg-[#1c1c1e] border border-[#262626] rounded-xl pl-9 pr-2 py-2 text-xs text-white focus:outline-none focus:border-[#0095f6] transition-colors"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-[#e5e5e5] mb-1.5">
                Data de Fim / Sorteio
              </label>
              <div className="relative">
                <Calendar className="w-4 h-4 text-[#737373] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full bg-[#1c1c1e] border border-[#262626] rounded-xl pl-9 pr-2 py-2 text-xs text-white focus:outline-none focus:border-[#0095f6] transition-colors"
                  required
                />
              </div>
            </div>
          </div>

          {/* Botões */}
          <div className="pt-3 flex items-center justify-end gap-2 border-t border-[#262626]">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 rounded-xl border border-[#262626] text-xs font-medium text-[#a8a8a8] hover:text-white hover:bg-[#262626] transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-yellow-500 hover:from-amber-600 hover:to-yellow-600 text-black font-bold text-xs shadow-lg shadow-amber-500/20 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Salvando...
                </>
              ) : (
                "Criar Rifa"
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
