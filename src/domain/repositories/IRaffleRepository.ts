import { Raffle, RaffleTicket, RaffleBuyer } from "../entities/Raffle";

export interface CreateRaffleInput {
  title: string;
  description?: string;
  imageUrl?: string;
  totalNumbers: number;
  pricePerNumber: number;
  startDate: string;
  endDate: string;
}

export interface PurchaseTicketsInput {
  raffleId: string;
  numbers: number[];
  buyer: RaffleBuyer;
  status: "reserved" | "paid";
  notes?: string;
}

export interface IRaffleRepository {
  /** Retorna a lista de todas as rifas cadastradas */
  getRaffles(): Promise<Raffle[]>;

  /** Busca uma rifa específica pelo seu ID */
  getRaffleById(id: string): Promise<Raffle | null>;

  /** Cria uma nova rifa */
  createRaffle(input: CreateRaffleInput): Promise<Raffle>;

  /** Atualiza dados de uma rifa existente */
  updateRaffle(id: string, updates: Partial<Raffle>): Promise<Raffle>;

  /** Exclui uma rifa */
  deleteRaffle(id: string): Promise<void>;

  /** Retorna todos os bilhetes de uma rifa */
  getTickets(raffleId: string): Promise<RaffleTicket[]>;

  /** Registra a compra ou reserva de bilhetes para um cliente */
  purchaseTickets(input: PurchaseTicketsInput): Promise<RaffleTicket[]>;

  /** Libera números reservados ou pagos, tornando-os disponíveis novamente */
  releaseTickets(raffleId: string, numbers: number[]): Promise<void>;
}
