/**
 * Entidades de Domínio - Gestão de Rifas (Clean Architecture)
 * Camada 1: Domínio puro, sem dependências externas ou de frameworks.
 */

export type RaffleStatus = "active" | "paused" | "drawn" | "cancelled";
export type TicketStatus = "available" | "reserved" | "paid";

export interface RaffleBuyer {
  name: string;
  username?: string; // @ do Instagram
  avatar?: string;
  phone?: string;
  conversationId?: string; // ID da conversa no Instagram Direct
}

export interface RaffleTicket {
  id: string;
  raffleId: string;
  number: number;
  formattedNumber: string;
  status: TicketStatus;
  buyer?: RaffleBuyer;
  paidAt?: string;
  reservedAt?: string;
  notes?: string;
  updatedAt: string;
}

export interface RaffleStats {
  total: number;
  available: number;
  reserved: number;
  paid: number;
  percentSold: number;
  totalRevenue: number;
  potentialRevenue: number;
}

export interface Raffle {
  id: string;
  title: string;
  description?: string;
  imageUrl?: string; // Foto / Banner do prêmio da rifa
  totalNumbers: number;
  pricePerNumber: number;
  startDate: string;
  endDate: string;
  status: RaffleStatus;
  winningNumber?: number | null;
  createdAt: string;
  updatedAt: string;
  stats?: RaffleStats;
}

/**
 * Formata um número de bilhete.
 * Em rifas de até 100 números: '01' a '09', '10' a '99', e '100' (sem zeros estranhos como 055 ou 099).
 * Em rifas maiores: formata de acordo com a quantidade de cotas.
 */
export function formatTicketNumber(num: number, totalNumbers: number): string {
  if (totalNumbers <= 100) {
    return num < 10 ? `0${num}` : String(num);
  }
  const digits = Math.max(2, String(totalNumbers - 1).length);
  return String(num).padStart(digits, "0");
}

/**
 * Calcula estatísticas agregadas em tempo real de uma rifa a partir dos bilhetes.
 */
export function calculateRaffleStats(
  raffle: Pick<Raffle, "totalNumbers" | "pricePerNumber">,
  tickets: RaffleTicket[]
): RaffleStats {
  const total = raffle.totalNumbers;
  let paid = 0;
  let reserved = 0;

  for (const ticket of tickets) {
    if (ticket.status === "paid") {
      paid++;
    } else if (ticket.status === "reserved") {
      reserved++;
    }
  }

  const available = Math.max(0, total - (paid + reserved));
  const percentSold = total > 0 ? Math.round((paid / total) * 100) : 0;
  const totalRevenue = paid * raffle.pricePerNumber;
  const potentialRevenue = total * raffle.pricePerNumber;

  return {
    total,
    available,
    reserved,
    paid,
    percentSold,
    totalRevenue,
    potentialRevenue,
  };
}
