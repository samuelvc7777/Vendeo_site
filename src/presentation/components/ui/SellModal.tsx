"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Camera, Sparkles, CheckCircle2 } from "lucide-react";
import { Category } from "@/domain/entities/Category";
import { CreateListingDTO } from "@/application/use-cases/PublishProductUseCase";

interface SellModalProps {
  isOpen: boolean;
  categories: Category[];
  onClose: () => void;
  onSubmitListing: (dto: CreateListingDTO) => Promise<void>;
}

export function SellModal({
  isOpen,
  categories,
  onClose,
  onSubmitListing,
}: SellModalProps) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("tech");
  const [isSuccess, setIsSuccess] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !price || isSubmitting) return;

    try {
      setIsSubmitting(true);
      await onSubmitListing({
        title,
        price: parseFloat(price),
        category,
      });

      setIsSuccess(true);
      setTimeout(() => {
        setIsSuccess(false);
        setTitle("");
        setPrice("");
        onClose();
      }, 1200);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
          />

          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 28, stiffness: 300 }}
            className="relative w-full sm:max-w-[430px] bg-slate-900 border-t border-slate-800 rounded-t-[32px] overflow-hidden p-5 max-h-[90vh] shadow-2xl z-10"
          >
            <div className="w-12 h-1.5 bg-slate-700 rounded-full mx-auto mb-4" />

            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-xl bg-emerald-500/10 flex items-center justify-center text-emerald-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <h3 className="text-base font-extrabold text-white">
                  Novo Anúncio no Vendeo
                </h3>
              </div>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-full bg-slate-800 flex items-center justify-center text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isSuccess ? (
              <div className="py-12 flex flex-col items-center justify-center text-center">
                <CheckCircle2 className="w-14 h-14 text-emerald-400 animate-bounce mb-3" />
                <h4 className="text-lg font-extrabold text-white">Anúncio Publicado!</h4>
                <p className="text-xs text-slate-400 mt-1">
                  Seu item já está visível para compradores no Vendeo.
                </p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Upload Foto */}
                <div className="border-2 border-dashed border-slate-700 hover:border-emerald-500/50 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 bg-slate-800/30 cursor-pointer transition-colors active:scale-98">
                  <div className="w-12 h-12 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                    <Camera className="w-6 h-6" />
                  </div>
                  <span className="text-xs font-semibold text-slate-300">
                    Adicionar fotos do produto
                  </span>
                  <span className="text-[10px] text-slate-500">
                    Até 6 fotos (JPG ou PNG)
                  </span>
                </div>

                {/* Título */}
                <div>
                  <label className="block text-xs font-bold text-slate-400 mb-1">
                    O que você está vendendo?
                  </label>
                  <input
                    type="text"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="Ex: PlayStation 5 Slim lacrado com NF"
                    required
                    className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                  />
                </div>

                {/* Preço e Categoria */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">
                      Preço (R$)
                    </label>
                    <input
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder="0,00"
                      required
                      min="1"
                      step="any"
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-slate-400 mb-1">
                      Categoria
                    </label>
                    <select
                      value={category}
                      onChange={(e) => setCategory(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 rounded-xl px-3 py-2.5 text-xs text-white focus:outline-none focus:border-emerald-500"
                    >
                      {categories
                        .filter((c) => c.id !== "all")
                        .map((cat) => (
                          <option key={cat.id} value={cat.id}>
                            {cat.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>

                {/* Botão de Enviar */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full py-3.5 rounded-2xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-slate-950 font-extrabold text-sm shadow-lg shadow-emerald-500/25 active:scale-95 transition-all mt-2 cursor-pointer"
                >
                  {isSubmitting ? "Publicando..." : "Publicar Anúncio Imediatamente"}
                </button>
              </form>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
