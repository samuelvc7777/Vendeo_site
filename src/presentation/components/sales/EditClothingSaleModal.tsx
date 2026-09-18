"use client";

import React, { useState, useEffect } from "react";
import {
  ClothingSale,
  ClothingSaleStatus,
  formatCpf,
  formatPhone,
  formatShippingLabel,
} from "@/domain/entities/ClothingSale";
import {
  X,
  Trash2,
  Check,
  Copy,
  Loader2,
  ShoppingBag,
  User,
  MapPin,
  Package,
  Truck,
  CheckCircle2,
} from "lucide-react";

interface EditClothingSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  sale: ClothingSale | null;
  onUpdate: (id: string, updates: Partial<ClothingSale>) => Promise<any>;
  onDelete: (id: string) => Promise<any>;
}

export function EditClothingSaleModal({
  isOpen,
  onClose,
  sale,
  onUpdate,
  onDelete,
}: EditClothingSaleModalProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerCpf, setCustomerCpf] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("SP");
  const [zipCode, setZipCode] = useState("");

  const [productDescription, setProductDescription] = useState("");
  const [saleAmount, setSaleAmount] = useState("");
  const [shippingPaid, setShippingPaid] = useState(true);
  const [shippingCost, setShippingCost] = useState("");
  const [inStock, setInStock] = useState(true);
  const [status, setStatus] = useState<ClothingSaleStatus>("paid");
  const [notes, setNotes] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (sale) {
      setCustomerName(sale.customerName || "");
      setCustomerCpf(formatCpf(sale.customerCpf || ""));
      setCustomerPhone(formatPhone(sale.customerPhone || ""));
      setStreet(sale.address?.street || "");
      setNumber(sale.address?.number || "");
      setComplement(sale.address?.complement || "");
      setNeighborhood(sale.address?.neighborhood || "");
      setCity(sale.address?.city || "");
      setState(sale.address?.state || "SP");
      setZipCode(sale.address?.zipCode || "");

      setProductDescription(sale.productDescription || "");
      setSaleAmount(String(sale.saleAmount || ""));
      setShippingPaid(Boolean(sale.shippingPaid));
      setShippingCost(String(sale.shippingCost || ""));
      setInStock(Boolean(sale.inStock));
      setStatus(sale.status || "paid");
      setNotes(sale.notes || "");
      setErrorMessage(null);
    }
  }, [sale]);

  if (!isOpen || !sale) return null;

  const handleCopyLabel = () => {
    const text = formatShippingLabel(sale);
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sale) return;

    const price = parseFloat(saleAmount.replace(",", "."));
    if (isNaN(price) || price <= 0) {
      setErrorMessage("Informe um valor válido.");
      return;
    }

    if (!customerPhone.trim()) {
      setErrorMessage("O telefone/WhatsApp é obrigatório.");
      return;
    }

    const cleanPhone = customerPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      setErrorMessage("Informe um telefone/WhatsApp válido com DDD.");
      return;
    }

    const shipping = shippingCost ? parseFloat(shippingCost.replace(",", ".")) : 0;

    try {
      setIsSubmitting(true);
      setErrorMessage(null);

      await onUpdate(sale.id, {
        customerName: customerName.trim(),
        customerCpf: customerCpf.replace(/\D/g, ""),
        customerPhone: cleanPhone,
        address: {
          street: street.trim(),
          number: number.trim(),
          complement: complement.trim() || undefined,
          neighborhood: neighborhood.trim(),
          city: city.trim(),
          state: state.trim().toUpperCase(),
          zipCode: zipCode.replace(/\D/g, "") || undefined,
        },
        productDescription: productDescription.trim(),
        saleAmount: price,
        shippingPaid,
        shippingCost: isNaN(shipping) ? 0 : shipping,
        inStock,
        status,
        notes: notes.trim() || undefined,
      });

      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || "Erro ao salvar alterações.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!sale) return;
    const confirm = window.confirm(
      `Deseja realmente EXCLUIR o registro de venda de "${sale.customerName}"?`
    );
    if (confirm) {
      try {
        setIsSubmitting(true);
        await onDelete(sale.id);
        onClose();
      } catch (err: any) {
        alert(err?.message || "Erro ao excluir venda.");
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#121214] border border-[#27272a] rounded-t-3xl sm:rounded-2xl p-5 text-white max-h-[92dvh] flex flex-col shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between pb-3 border-b border-[#27272a]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-pink-500/20 border border-pink-500/40 flex items-center justify-center text-pink-400">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white">Editar Registro de Venda</h2>
              <p className="text-[11px] text-[#a1a1aa]">{sale.customerName}</p>
            </div>
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handleCopyLabel}
              className="p-1.5 rounded-lg text-pink-400 hover:bg-pink-500/15 transition-colors cursor-pointer"
              title="Copiar etiqueta de envio"
            >
              {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="p-1.5 rounded-lg text-rose-400 hover:bg-rose-500/15 transition-colors cursor-pointer"
              title="Excluir venda"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#71717a] hover:text-white hover:bg-[#27272a] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Formulário de edição */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto py-3.5 space-y-4 no-scrollbar">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {errorMessage}
            </div>
          )}

          {/* STATUS DO PEDIDO */}
          <div className="space-y-1.5">
            <label className="block text-[11px] font-medium text-[#a1a1aa]">
              Status do Pedido
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {(
                [
                  { key: "paid", label: "Pago" },
                  { key: "pending", label: "Pendente" },
                  { key: "shipped", label: "Enviado" },
                  { key: "delivered", label: "Entregue" },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setStatus(item.key)}
                  className={`py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                    status === item.key
                      ? "bg-pink-500 text-white shadow-md shadow-pink-500/30"
                      : "bg-[#18181b] border border-[#27272a] text-[#71717a] hover:text-white"
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {/* ESTOQUE E FRETE */}
          <div className="grid grid-cols-2 gap-2">
            <div className="p-3 rounded-xl bg-[#18181b] border border-[#27272a]">
              <span className="text-[11px] text-[#a1a1aa] block mb-1">Em Estoque?</span>
              <button
                type="button"
                onClick={() => setInStock(!inStock)}
                className={`w-full py-1.5 rounded-lg text-xs font-bold transition-all ${
                  inStock
                    ? "bg-emerald-500/20 border border-emerald-500/50 text-emerald-300"
                    : "bg-amber-500/20 border border-amber-500/50 text-amber-300"
                }`}
              >
                {inStock ? "Sim (Pronta Entrega)" : "Não (Sob Encomenda)"}
              </button>
            </div>

            <div className="p-3 rounded-xl bg-[#18181b] border border-[#27272a]">
              <span className="text-[11px] text-[#a1a1aa] block mb-1">Frete Pago?</span>
              <button
                type="button"
                onClick={() => setShippingPaid(!shippingPaid)}
                className={`w-full py-1.5 rounded-lg text-xs font-bold transition-all ${
                  shippingPaid
                    ? "bg-emerald-500/20 border border-emerald-500/50 text-emerald-300"
                    : "bg-rose-500/20 border border-rose-500/50 text-rose-300"
                }`}
              >
                {shippingPaid ? "Frete Pago" : "Frete Pendente"}
              </button>
            </div>
          </div>

          {/* DADOS BÁSICOS */}
          <div className="space-y-2">
            <div>
              <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                Nome do Cliente
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  CPF
                </label>
                <input
                  type="text"
                  value={customerCpf}
                  onChange={(e) => setCustomerCpf(formatCpf(e.target.value))}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  Telefone / WhatsApp *
                </label>
                <input
                  type="tel"
                  required
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(formatPhone(e.target.value))}
                  maxLength={15}
                  placeholder="(11) 99999-9999"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-pink-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                Peça / Produto
              </label>
              <input
                type="text"
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  Valor Vendido (R$)
                </label>
                <input
                  type="text"
                  value={saleAmount}
                  onChange={(e) => setSaleAmount(e.target.value)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-emerald-400 font-bold font-mono"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  Valor Frete (R$)
                </label>
                <input
                  type="text"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(e.target.value)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white font-mono"
                />
              </div>
            </div>

            {/* Endereço */}
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">Rua</label>
                <input
                  type="text"
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">Número</label>
                <input
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">Bairro</label>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">Cidade</label>
                <input
                  type="text"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white"
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">UF</label>
                <input
                  type="text"
                  maxLength={2}
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white uppercase"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">Observações</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white resize-none"
              />
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-[#18181b] border border-[#27272a] text-xs font-bold text-[#a1a1aa] hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-pink-500 hover:bg-pink-600 text-white font-bold text-xs shadow-md shadow-pink-500/20 active:scale-95 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              {isSubmitting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              <span>Salvar Alterações</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
