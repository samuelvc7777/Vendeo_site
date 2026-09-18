"use client";

import React, { useState } from "react";
import { CreateClothingSaleInput } from "@/domain/repositories/IClothingSaleRepository";
import { formatCpf, formatPhone } from "@/domain/entities/ClothingSale";
import {
  X,
  Plus,
  Loader2,
  Sparkles,
  ShoppingBag,
  User,
  MapPin,
  Truck,
  CheckCircle2,
  Package,
  Phone,
  Search,
} from "lucide-react";

interface CreateClothingSaleModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (input: CreateClothingSaleInput) => Promise<any>;
}

export function CreateClothingSaleModal({
  isOpen,
  onClose,
  onSubmit,
}: CreateClothingSaleModalProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerCpf, setCustomerCpf] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");

  // Endereço
  const [street, setStreet] = useState("");
  const [number, setNumber] = useState("");
  const [complement, setComplement] = useState("");
  const [neighborhood, setNeighborhood] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("SP");
  const [zipCode, setZipCode] = useState("");
  const [isLoadingCep, setIsLoadingCep] = useState(false);

  // Venda & Produto
  const [productDescription, setProductDescription] = useState("");
  const [saleAmount, setSaleAmount] = useState("");
  const [shippingPaid, setShippingPaid] = useState(true);
  const [shippingCost, setShippingCost] = useState("");
  const [inStock, setInStock] = useState(true);
  const [notes, setNotes] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  // Busca CEP automático via ViaCEP
  const handleCepBlur = async () => {
    const cleanCep = zipCode.replace(/\D/g, "");
    if (cleanCep.length === 8) {
      try {
        setIsLoadingCep(true);
        const res = await fetch(`https://viacep.com.br/ws/${cleanCep}/json/`);
        if (res.ok) {
          const data = await res.json();
          if (!data.erro) {
            if (data.logradouro) setStreet(data.logradouro);
            if (data.bairro) setNeighborhood(data.bairro);
            if (data.localidade) setCity(data.localidade);
            if (data.uf) setState(data.uf);
          }
        }
      } catch (e) {
        console.warn("Erro ao buscar CEP:", e);
      } finally {
        setIsLoadingCep(false);
      }
    }
  };

  const handleCpfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCpf(e.target.value);
    setCustomerCpf(formatted);
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setCustomerPhone(formatted);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);

    if (!customerName.trim()) {
      setErrorMessage("Informe o nome do cliente.");
      return;
    }

    if (!customerPhone.trim()) {
      setErrorMessage("O número de telefone celular / WhatsApp é obrigatório.");
      return;
    }

    const cleanPhone = customerPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      setErrorMessage("Informe um número de telefone celular / WhatsApp válido com DDD.");
      return;
    }

    if (!productDescription.trim()) {
      setErrorMessage("Informe a descrição da peça vendida.");
      return;
    }

    const price = parseFloat(saleAmount.replace(",", "."));
    if (isNaN(price) || price <= 0) {
      setErrorMessage("Informe um valor de venda válido.");
      return;
    }

    if (!street.trim() || !city.trim()) {
      setErrorMessage("Informe ao menos a Rua e a Cidade no endereço.");
      return;
    }

    const shipping = shippingCost ? parseFloat(shippingCost.replace(",", ".")) : 0;

    try {
      setIsSubmitting(true);
      await onSubmit({
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
        notes: notes.trim() || undefined,
        status: "paid",
      });

      // Limpa formulário
      setCustomerName("");
      setCustomerCpf("");
      setCustomerPhone("");
      setStreet("");
      setNumber("");
      setComplement("");
      setNeighborhood("");
      setCity("");
      setZipCode("");
      setProductDescription("");
      setSaleAmount("");
      setShippingCost("");
      setNotes("");

      onClose();
    } catch (err: any) {
      setErrorMessage(err?.message || "Erro ao cadastrar venda.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-[#121214] border border-[#27272a] rounded-t-3xl sm:rounded-2xl p-5 text-white max-h-[92dvh] flex flex-col shadow-2xl">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between pb-3 border-b border-[#27272a]">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-500/20 to-purple-500/20 border border-pink-500/40 flex items-center justify-center text-pink-400">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-1.5">
                Nova Venda de Roupa
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 font-semibold">
                  Moda
                </span>
              </h2>
              <p className="text-[11px] text-[#a1a1aa]">
                Cadastre o cliente, endereço e detalhes da peça vendida
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-[#71717a] hover:text-white hover:bg-[#27272a] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Formulário com rolagem */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto py-3.5 space-y-4 no-scrollbar">
          {errorMessage && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              {errorMessage}
            </div>
          )}

          {/* SEÇÃO 1: CLIENTE */}
          <div className="space-y-2.5">
            <h3 className="text-xs font-bold text-[#e4e4e7] flex items-center gap-1.5">
              <User className="w-3.5 h-3.5 text-pink-400" />
              Dados do Cliente
            </h3>

            <div>
              <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                Nome do Cliente *
              </label>
              <input
                type="text"
                required
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Ex: Larissa Silva"
                className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-pink-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  CPF do Cliente
                </label>
                <input
                  type="text"
                  value={customerCpf}
                  onChange={handleCpfChange}
                  maxLength={14}
                  placeholder="000.000.000-00"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] font-mono focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  Telefone / WhatsApp *
                </label>
                <div className="relative">
                  <Phone className="w-3.5 h-3.5 text-pink-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="tel"
                    required
                    value={customerPhone}
                    onChange={handlePhoneChange}
                    maxLength={15}
                    placeholder="(11) 99999-9999"
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-[#71717a] font-mono focus:outline-none focus:border-pink-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* SEÇÃO 2: ENDEREÇO DE ENTREGA */}
          <div className="space-y-2.5 pt-2 border-t border-[#27272a]">
            <h3 className="text-xs font-bold text-[#e4e4e7] flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-pink-400" />
              Endereço de Envio
            </h3>

            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-1">
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  CEP
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={zipCode}
                    onChange={(e) => setZipCode(e.target.value)}
                    onBlur={handleCepBlur}
                    maxLength={9}
                    placeholder="00000-000"
                    className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] font-mono focus:outline-none focus:border-pink-500"
                  />
                  {isLoadingCep && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-pink-400 absolute right-2.5 top-1/2 -translate-y-1/2" />
                  )}
                </div>
              </div>

              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  Rua / Logradouro *
                </label>
                <input
                  type="text"
                  required
                  value={street}
                  onChange={(e) => setStreet(e.target.value)}
                  placeholder="Ex: Av. Paulista"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-pink-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  Número
                </label>
                <input
                  type="text"
                  value={number}
                  onChange={(e) => setNumber(e.target.value)}
                  placeholder="Ex: 1500"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-pink-500"
                />
              </div>

              <div className="col-span-2">
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  Complemento / Apto
                </label>
                <input
                  type="text"
                  value={complement}
                  onChange={(e) => setComplement(e.target.value)}
                  placeholder="Apto 42, Bloco B"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-pink-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  Bairro
                </label>
                <input
                  type="text"
                  value={neighborhood}
                  onChange={(e) => setNeighborhood(e.target.value)}
                  placeholder="Centro"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  Cidade *
                </label>
                <input
                  type="text"
                  required
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="São Paulo"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  UF
                </label>
                <input
                  type="text"
                  maxLength={2}
                  value={state}
                  onChange={(e) => setState(e.target.value.toUpperCase())}
                  placeholder="SP"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] font-mono uppercase focus:outline-none focus:border-pink-500"
                />
              </div>
            </div>
          </div>

          {/* SEÇÃO 3: PRODUTO, VALOR, FRETE E ESTOQUE */}
          <div className="space-y-2.5 pt-2 border-t border-[#27272a]">
            <h3 className="text-xs font-bold text-[#e4e4e7] flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-pink-400" />
              Produto, Valores e Estoque
            </h3>

            <div>
              <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                Peça / Descrição da Roupa *
              </label>
              <input
                type="text"
                required
                value={productDescription}
                onChange={(e) => setProductDescription(e.target.value)}
                placeholder="Ex: Vestido Midi Canelado Preto (Tam M)"
                className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-pink-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  Valor Vendido (R$) *
                </label>
                <input
                  type="text"
                  required
                  value={saleAmount}
                  onChange={(e) => setSaleAmount(e.target.value)}
                  placeholder="149,90"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white font-bold text-emerald-400 placeholder-[#71717a] font-mono focus:outline-none focus:border-pink-500"
                />
              </div>

              <div>
                <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                  Valor do Frete (R$)
                </label>
                <input
                  type="text"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(e.target.value)}
                  placeholder="25,00"
                  className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] font-mono focus:outline-none focus:border-pink-500"
                />
              </div>
            </div>

            {/* TOGGLE 1: O PRODUTO ESTÁ EM ESTOQUE? */}
            <div className="p-3 rounded-xl bg-[#18181b] border border-[#27272a] flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">
                  Produto em Estoque?
                </span>
                <span className="text-[10px] text-[#a1a1aa]">
                  {inStock ? "Pronta entrega imediata" : "Sob encomenda / Produção"}
                </span>
              </div>
              <div className="flex items-center gap-1 bg-[#121214] p-1 rounded-xl border border-[#27272a]">
                <button
                  type="button"
                  onClick={() => setInStock(true)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    inStock
                      ? "bg-emerald-500 text-black shadow-sm"
                      : "text-[#71717a] hover:text-white"
                  }`}
                >
                  Sim (Estoque)
                </button>
                <button
                  type="button"
                  onClick={() => setInStock(false)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    !inStock
                      ? "bg-amber-500 text-black shadow-sm"
                      : "text-[#71717a] hover:text-white"
                  }`}
                >
                  Não (Encomenda)
                </button>
              </div>
            </div>

            {/* TOGGLE 2: O FRETE FOI PAGO? */}
            <div className="p-3 rounded-xl bg-[#18181b] border border-[#27272a] flex items-center justify-between">
              <div>
                <span className="text-xs font-bold text-white block">
                  Frete foi Pago?
                </span>
                <span className="text-[10px] text-[#a1a1aa]">
                  {shippingPaid ? "Cliente já pagou o frete" : "Frete pendente de pagamento"}
                </span>
              </div>
              <div className="flex items-center gap-1 bg-[#121214] p-1 rounded-xl border border-[#27272a]">
                <button
                  type="button"
                  onClick={() => setShippingPaid(true)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    shippingPaid
                      ? "bg-emerald-500 text-black shadow-sm"
                      : "text-[#71717a] hover:text-white"
                  }`}
                >
                  Pago
                </button>
                <button
                  type="button"
                  onClick={() => setShippingPaid(false)}
                  className={`px-3 py-1 rounded-lg text-xs font-bold transition-all ${
                    !shippingPaid
                      ? "bg-rose-500 text-white shadow-sm"
                      : "text-[#71717a] hover:text-white"
                  }`}
                >
                  Pendente
                </button>
              </div>
            </div>

            {/* Observações adicionais */}
            <div>
              <label className="block text-[11px] font-medium text-[#a1a1aa] mb-1">
                Observações (opcional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                placeholder="Ex: Embalar para presente, mandar brinde..."
                className="w-full bg-[#18181b] border border-[#27272a] rounded-xl px-3 py-2 text-xs text-white placeholder-[#71717a] focus:outline-none focus:border-pink-500 resize-none"
              />
            </div>
          </div>

          {/* Botões do Rodapé */}
          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-[#18181b] border border-[#27272a] text-xs font-bold text-[#a1a1aa] hover:text-white transition-colors"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 hover:from-pink-600 hover:to-rose-600 text-white font-bold text-xs shadow-lg shadow-pink-500/20 active:scale-95 transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Cadastrando...</span>
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  <span>Cadastrar Venda</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
