"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { createWhatsApp2Client } from "./whatsapp2-client";
import { WhatsAppStatusRepository } from "@/infrastructure/repositories/WhatsAppStatusRepository";
import { WhatsAppStoryMediaRepository } from "@/infrastructure/repositories/WhatsAppStoryMediaRepository";

export type WhatsAppConnection = {
  id: string;
  name: string;
  accountId: string | null;
  enabled: boolean;
  status: string;
  lastError?: string | null;
};

const Context = createContext<WhatsAppConnection | undefined>(undefined);

export function WhatsAppAccountProvider({ account, children }: { account?: WhatsAppConnection; children: ReactNode }) {
  return <Context.Provider value={account}>{children}</Context.Provider>;
}

export function useWhatsAppAccount() { return useContext(Context); }

export function useWhatsApp2Client() {
  const account = useWhatsAppAccount();
  // Cada chamada mantém este vínculo, inclusive depois de await e durante troca de tela.
  return useMemo(() => createWhatsApp2Client(account?.id), [account?.id]);
}

export function useWhatsAppStatusRepository() {
  const account = useWhatsAppAccount();
  return useMemo(() => WhatsAppStatusRepository.forAccount(account?.accountId || "primary", !account || account.id === "legacy"), [account?.accountId, account?.id]);
}

export function useWhatsAppStoryRepository() {
  const account = useWhatsAppAccount();
  return useMemo(() => WhatsAppStoryMediaRepository.forConnection(account?.id), [account?.id]);
}
