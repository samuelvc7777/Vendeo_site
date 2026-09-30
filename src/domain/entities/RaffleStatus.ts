export type RaffleCommercialStatus = "offered" | "bought" | "not_bought" | null;

export const RAFFLE_COMMERCIAL_STATUS_OPTIONS: Array<{
  value: RaffleCommercialStatus;
  label: string;
}> = [
  { value: null, label: "Não oferecido" },
  { value: "offered", label: "Oferecido" },
  { value: "bought", label: "Comprou" },
  { value: "not_bought", label: "Não comprou" },
];

export function normalizeRaffleCommercialStatus(value: unknown): RaffleCommercialStatus {
  return value === "offered" || value === "bought" || value === "not_bought"
    ? value
    : null;
}

export function raffleCommercialStatusLabel(status: RaffleCommercialStatus): string {
  return status === "offered"
    ? "Oferecido"
    : status === "bought"
    ? "Comprou"
    : status === "not_bought"
    ? "Não comprou"
    : "Não oferecido";
}
