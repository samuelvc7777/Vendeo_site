"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, Check, MessageCircle } from "lucide-react";
import { ResponsiveModal } from "@/presentation/components/ui/ResponsiveModal";
import type { WhatsAppConnection } from "./WhatsAppAccountContext";

export function WhatsAppAccountSelector({ accounts, selectedId, onChange }: {
  accounts: WhatsAppConnection[];
  selectedId?: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const selected = accounts.find(account => account.id === selectedId);

  return <>
    <button
      type="button"
      aria-label="Trocar conta de WhatsApp"
      aria-haspopup="dialog"
      aria-expanded={open}
      title={selected ? `Trocar WhatsApp · ${selected.name}` : "Trocar WhatsApp"}
      onClick={() => setOpen(true)}
      className="flex min-h-10 min-w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-zinc-100 text-zinc-500 transition hover:text-zinc-950 active:scale-95 dark:bg-[#171717] dark:text-[#8e8e8e] dark:hover:text-white"
    >
      <ArrowLeftRight className="h-4 w-4" />
    </button>

    {mounted && createPortal(<ResponsiveModal
      isOpen={open}
      onClose={() => setOpen(false)}
      title="Trocar WhatsApp"
      description="Escolha a conta para ver as conversas."
      maxWidth="sm"
    >
      <div className="space-y-2">
        {accounts.map(account => {
          const active = account.id === selectedId;
          const connected = account.status === "ready";
          const status = connected ? "Conectado" : account.enabled ? "Desconectado" : "Pausado";
          return <button
            key={account.id}
            type="button"
            aria-pressed={active}
            onClick={() => { setOpen(false); if (!active) onChange(account.id); }}
            className={`flex min-h-[88px] w-full items-center gap-3 rounded-2xl border p-4 text-left transition active:scale-[0.99] ${active
              ? "border-emerald-500/40 bg-emerald-50 dark:bg-emerald-500/[0.08]"
              : "border-zinc-200 bg-zinc-50 hover:bg-zinc-100 dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.06]"}`}
          >
            <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${active ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-zinc-200/70 text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400"}`}>
              <MessageCircle className="h-5 w-5" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-zinc-950 dark:text-white">{account.name}</span>
              {account.accountId && <span className="mt-0.5 block truncate text-xs text-zinc-500 dark:text-zinc-400">{account.accountId.replace("account-", "+")}</span>}
              <span className="mt-1.5 flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
                <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-600"}`} />
                {status}{active && " · Em uso"}
              </span>
            </span>
            {active && <Check className="h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />}
          </button>;
        })}
      </div>
    </ResponsiveModal>, document.body)}
  </>;
}
