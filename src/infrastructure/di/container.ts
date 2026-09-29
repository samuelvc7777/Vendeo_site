import { SupabaseVaultRepository } from "../repositories/SupabaseVaultRepository";
import { ManageVaultUseCase } from "@/application/use-cases/ManageVaultUseCase";
import { SupabaseRaffleRepository } from "../repositories/SupabaseRaffleRepository";
import { ManageRaffleUseCase } from "@/application/use-cases/ManageRaffleUseCase";
import { SupabaseClothingSaleRepository } from "../repositories/SupabaseClothingSaleRepository";
import { ManageClothingSaleUseCase } from "@/application/use-cases/ManageClothingSaleUseCase";

const vaultRepository = new SupabaseVaultRepository();
const raffleRepository = new SupabaseRaffleRepository();
const clothingSaleRepository = new SupabaseClothingSaleRepository();

export const manageVaultUseCase = new ManageVaultUseCase(vaultRepository);
export const manageRaffleUseCase = new ManageRaffleUseCase(raffleRepository);
export const manageClothingSaleUseCase = new ManageClothingSaleUseCase(clothingSaleRepository);
