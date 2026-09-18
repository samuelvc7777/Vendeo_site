import {
  Raffle,
  RaffleTicket,
  calculateRaffleStats,
  formatTicketNumber,
} from "@/domain/entities/Raffle";
import {
  CreateRaffleInput,
  IRaffleRepository,
  PurchaseTicketsInput,
} from "@/domain/repositories/IRaffleRepository";

export interface RaffleWithDetails {
  raffle: Raffle;
  tickets: RaffleTicket[];
}

export class ManageRaffleUseCase {
  constructor(private readonly raffleRepository: IRaffleRepository) {}

  /**
   * Lista todas as rifas com suas estatísticas agregadas.
   */
  async getRaffles(): Promise<Raffle[]> {
    const raffles = await this.raffleRepository.getRaffles();
    return raffles;
  }

  /**
   * Obtém os detalhes completos de uma rifa junto aos seus bilhetes e estatísticas atualizadas.
   */
  async getRaffleWithDetails(id: string): Promise<RaffleWithDetails | null> {
    const raffle = await this.raffleRepository.getRaffleById(id);
    if (!raffle) return null;

    const tickets = await this.raffleRepository.getTickets(id);
    const stats = calculateRaffleStats(raffle, tickets);

    return {
      raffle: {
        ...raffle,
        stats,
      },
      tickets,
    };
  }

  /**
   * Cria uma nova rifa.
   */
  async createRaffle(input: CreateRaffleInput): Promise<Raffle> {
    if (!input.title || input.title.trim() === "") {
      throw new Error("O título da rifa é obrigatório.");
    }
    if (input.totalNumbers <= 0) {
      throw new Error("A quantidade de números deve ser maior que zero.");
    }
    if (input.pricePerNumber <= 0) {
      throw new Error("O preço por número deve ser maior que zero.");
    }

    return this.raffleRepository.createRaffle(input);
  }

  /**
   * Atualiza dados de uma rifa.
   */
  async updateRaffle(id: string, updates: Partial<Raffle>): Promise<Raffle> {
    return this.raffleRepository.updateRaffle(id, updates);
  }

  /**
   * Exclui uma rifa.
   */
  async deleteRaffle(id: string): Promise<void> {
    return this.raffleRepository.deleteRaffle(id);
  }

  /**
   * Registra a compra ou reserva de cotas da rifa com validações de integridade.
   */
  async purchaseOrReserveTickets(
    input: PurchaseTicketsInput
  ): Promise<{ success: boolean; tickets: RaffleTicket[] }> {
    if (!input.numbers || input.numbers.length === 0) {
      throw new Error("Nenhum número selecionado para a compra.");
    }

    const raffle = await this.raffleRepository.getRaffleById(input.raffleId);
    if (!raffle) {
      throw new Error("Rifa não encontrada.");
    }

    // Valida se os números estão dentro dos limites da rifa (1 até totalNumbers)
    for (const num of input.numbers) {
      if (num < 1 || num > raffle.totalNumbers) {
        throw new Error(
          `Número ${num} está fora do intervalo da rifa (1 a ${raffle.totalNumbers}).`
        );
      }
    }

    const updatedTickets = await this.raffleRepository.purchaseTickets(input);
    return { success: true, tickets: updatedTickets };
  }

  /**
   * Libera cotas que estavam reservadas ou pagas.
   */
  async releaseTickets(raffleId: string, numbers: number[]): Promise<void> {
    if (!numbers || numbers.length === 0) return;
    await this.raffleRepository.releaseTickets(raffleId, numbers);
  }
}
