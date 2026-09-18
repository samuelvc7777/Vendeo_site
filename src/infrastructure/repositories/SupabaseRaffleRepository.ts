import {
  Raffle,
  RaffleTicket,
  formatTicketNumber,
} from "@/domain/entities/Raffle";
import {
  CreateRaffleInput,
  IRaffleRepository,
  PurchaseTicketsInput,
} from "@/domain/repositories/IRaffleRepository";
import { getSupabaseBrowserClient } from "../supabase/client";
import { getSupabaseServerClient } from "../supabase/server";

const STORAGE_RAFFLES_KEY = "vendeo_raffles_v1";
const STORAGE_TICKETS_KEY = "vendeo_raffle_tickets_v1";
const SUPABASE_RAFFLE_DOCUMENT_ID = "__raffle_data__";

interface StoredRaffleCloudPayload {
  raffles: Raffle[];
  tickets: Record<string, RaffleTicket[]>;
  updated_at: string;
}

function generateId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `raffle_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

export class SupabaseRaffleRepository implements IRaffleRepository {
  private inMemoryRaffles: Raffle[] | null = null;
  private inMemoryTickets: Map<string, RaffleTicket[]> = new Map();
  private lastFetchTime = 0;
  private cacheDurationMs = 1500; // 1.5s de debounce para alta responsividade

  private getClient() {
    if (typeof window !== "undefined") {
      return getSupabaseBrowserClient();
    }
    return getSupabaseServerClient();
  }

  // ==========================================
  // CACHE LOCAL (FALLBACK OFFLINE)
  // ==========================================
  private getLocalRaffles(): Raffle[] {
    if (typeof window === "undefined") return [];
    try {
      const data = localStorage.getItem(STORAGE_RAFFLES_KEY);
      if (!data) return [];
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private saveLocalRaffles(raffles: Raffle[]): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(STORAGE_RAFFLES_KEY, JSON.stringify(raffles));
    } catch (e) {
      console.warn("Erro ao salvar cache local de rifas:", e);
    }
  }

  private getLocalTickets(raffleId: string): RaffleTicket[] {
    if (typeof window === "undefined") return [];
    try {
      const data = localStorage.getItem(`${STORAGE_TICKETS_KEY}_${raffleId}`);
      if (!data) return [];
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  private saveLocalTickets(raffleId: string, tickets: RaffleTicket[]): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(
        `${STORAGE_TICKETS_KEY}_${raffleId}`,
        JSON.stringify(tickets)
      );
    } catch (e) {
      console.warn("Erro ao salvar cache local de tickets:", e);
    }
  }

  // ==========================================
  // PERSISTÊNCIA NA NUVEM (SUPABASE)
  // ==========================================
  private async fetchCloudPayload(force = false): Promise<StoredRaffleCloudPayload> {
    const now = Date.now();
    if (
      !force &&
      this.inMemoryRaffles !== null &&
      now - this.lastFetchTime < this.cacheDurationMs
    ) {
      const ticketsObj: Record<string, RaffleTicket[]> = {};
      this.inMemoryTickets.forEach((val, key) => {
        ticketsObj[key] = val;
      });
      return {
        raffles: this.inMemoryRaffles,
        tickets: ticketsObj,
        updated_at: new Date(this.lastFetchTime).toISOString(),
      };
    }

    const client = this.getClient();
    if (client) {
      try {
        const { data, error } = await client
          .from("instagram_conversations")
          .select("stage_completed_rules")
          .eq("id", SUPABASE_RAFFLE_DOCUMENT_ID)
          .maybeSingle();

        if (!error && data?.stage_completed_rules) {
          const cloudPayload = data.stage_completed_rules as StoredRaffleCloudPayload;
          if (Array.isArray(cloudPayload.raffles)) {
            this.inMemoryRaffles = cloudPayload.raffles;
            this.inMemoryTickets.clear();

            if (cloudPayload.tickets && typeof cloudPayload.tickets === "object") {
              for (const [rId, tList] of Object.entries(cloudPayload.tickets)) {
                if (Array.isArray(tList)) {
                  this.inMemoryTickets.set(rId, tList);
                  this.saveLocalTickets(rId, tList);
                }
              }
            }

            this.lastFetchTime = now;
            this.saveLocalRaffles(cloudPayload.raffles);

            return cloudPayload;
          }
        }
      } catch (err) {
        console.warn("Falha ao buscar rifas do Supabase, utilizando cache local:", err);
      }
    }

    // Fallback: monta com base no cache local se a nuvem estiver indisponível
    let localRaffles = this.getLocalRaffles();
    if (localRaffles.length === 0) {
      const defaultRaffle: Raffle = {
        id: "raffle_moto_160_oficial",
        title: "Rifa da Moto Honda Fan 160cc 0km",
        description: "Participe da rifa oficial! Apenas 100 números disponíveis.",
        totalNumbers: 100,
        pricePerNumber: 15.0,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        status: "active",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      localRaffles = [defaultRaffle];
      this.saveLocalRaffles(localRaffles);
    }

    this.inMemoryRaffles = localRaffles;
    const ticketsObj: Record<string, RaffleTicket[]> = {};
    for (const r of localRaffles) {
      const t = this.getLocalTickets(r.id);
      ticketsObj[r.id] = t;
      this.inMemoryTickets.set(r.id, t);
    }

    return {
      raffles: localRaffles,
      tickets: ticketsObj,
      updated_at: new Date().toISOString(),
    };
  }

  private async saveCloudPayload(
    raffles: Raffle[],
    tickets: Record<string, RaffleTicket[]>
  ): Promise<void> {
    const now = new Date().toISOString();
    const payload: StoredRaffleCloudPayload = {
      raffles,
      tickets,
      updated_at: now,
    };

    // Atualiza estado em memória e cache local
    this.inMemoryRaffles = raffles;
    this.inMemoryTickets.clear();
    for (const [rId, tList] of Object.entries(tickets)) {
      this.inMemoryTickets.set(rId, tList);
      this.saveLocalTickets(rId, tList);
    }
    this.lastFetchTime = Date.now();
    this.saveLocalRaffles(raffles);

    // Salva no Supabase para sincronização instantânea com todos os celulares
    const client = this.getClient();
    if (client) {
      try {
        const { error } = await client.from("instagram_conversations").upsert({
          id: SUPABASE_RAFFLE_DOCUMENT_ID,
          username: "__raffle__",
          full_name: "Rifas Compartilhadas Vendeo",
          status: "system",
          unread: false,
          stage_completed_rules: payload,
          updated_at: now,
        });

        if (error) {
          console.error("Erro ao sincronizar rifas no Supabase:", error);
        }
      } catch (err) {
        console.error("Exceção ao persistir rifas no Supabase:", err);
      }
    }
  }

  // ==========================================
  // OPERAÇÕES DE RIFAS
  // ==========================================

  async getRaffles(): Promise<Raffle[]> {
    const payload = await this.fetchCloudPayload();
    return payload.raffles;
  }

  async getRaffleById(id: string): Promise<Raffle | null> {
    const raffles = await this.getRaffles();
    return raffles.find((r) => r.id === id) || null;
  }

  async createRaffle(input: CreateRaffleInput): Promise<Raffle> {
    const payload = await this.fetchCloudPayload(true);
    const now = new Date().toISOString();

    const newRaffle: Raffle = {
      id: generateId(),
      title: input.title.trim(),
      description: input.description?.trim(),
      totalNumbers: input.totalNumbers,
      pricePerNumber: input.pricePerNumber,
      startDate: input.startDate || now,
      endDate: input.endDate,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };

    const updatedRaffles = [newRaffle, ...payload.raffles];
    payload.tickets[newRaffle.id] = [];

    await this.saveCloudPayload(updatedRaffles, payload.tickets);
    return newRaffle;
  }

  async updateRaffle(id: string, updates: Partial<Raffle>): Promise<Raffle> {
    const payload = await this.fetchCloudPayload(true);
    const index = payload.raffles.findIndex((r) => r.id === id);
    if (index === -1) {
      throw new Error("Rifa não encontrada no servidor.");
    }

    const updated: Raffle = {
      ...payload.raffles[index],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    payload.raffles[index] = updated;
    await this.saveCloudPayload(payload.raffles, payload.tickets);
    return updated;
  }

  async deleteRaffle(id: string): Promise<void> {
    const payload = await this.fetchCloudPayload(true);
    const filteredRaffles = payload.raffles.filter((r) => r.id !== id);
    delete payload.tickets[id];

    await this.saveCloudPayload(filteredRaffles, payload.tickets);

    if (typeof window !== "undefined") {
      localStorage.removeItem(`${STORAGE_TICKETS_KEY}_${id}`);
    }
  }

  // ==========================================
  // OPERAÇÕES DE BILHETES / COTAS
  // ==========================================

  async getTickets(raffleId: string): Promise<RaffleTicket[]> {
    const payload = await this.fetchCloudPayload();
    return payload.tickets[raffleId] || [];
  }

  async purchaseTickets(input: PurchaseTicketsInput): Promise<RaffleTicket[]> {
    const payload = await this.fetchCloudPayload(true);
    const now = new Date().toISOString();

    const raffle = payload.raffles.find((r) => r.id === input.raffleId);
    const totalNumbers = raffle ? raffle.totalNumbers : 100;

    const currentTickets = payload.tickets[input.raffleId] || [];
    const ticketsMap = new Map<number, RaffleTicket>();
    for (const t of currentTickets) {
      ticketsMap.set(t.number, t);
    }

    const updatedTickets: RaffleTicket[] = [];

    for (const num of input.numbers) {
      const existing = ticketsMap.get(num);
      const ticketId = existing ? existing.id : generateId();
      const updatedTicket: RaffleTicket = {
        id: ticketId,
        raffleId: input.raffleId,
        number: num,
        formattedNumber: formatTicketNumber(num, totalNumbers),
        status: input.status,
        buyer: input.buyer,
        paidAt: input.status === "paid" ? now : existing?.paidAt,
        reservedAt: input.status === "reserved" ? now : existing?.reservedAt,
        notes: input.notes ?? existing?.notes,
        updatedAt: now,
      };

      ticketsMap.set(num, updatedTicket);
      updatedTickets.push(updatedTicket);
    }

    payload.tickets[input.raffleId] = Array.from(ticketsMap.values());
    await this.saveCloudPayload(payload.raffles, payload.tickets);

    return updatedTickets;
  }

  async releaseTickets(raffleId: string, numbers: number[]): Promise<void> {
    const payload = await this.fetchCloudPayload(true);
    const currentTickets = payload.tickets[raffleId] || [];
    const setOfNumbers = new Set(numbers);

    payload.tickets[raffleId] = currentTickets.filter(
      (t) => !setOfNumbers.has(t.number)
    );

    await this.saveCloudPayload(payload.raffles, payload.tickets);
  }
}
