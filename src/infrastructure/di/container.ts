import { MockProductRepository } from "../repositories/MockProductRepository";
import { LocalStorageCartRepository } from "../repositories/LocalStorageCartRepository";
import { MockChatRepository } from "../repositories/MockChatRepository";
import { ApiTinderRepository } from "../repositories/ApiTinderRepository";
import { SupabaseTinderRepository } from "../repositories/SupabaseTinderRepository";

import { GetProductsUseCase } from "@/application/use-cases/GetProductsUseCase";
import { GetCategoriesUseCase } from "@/application/use-cases/GetCategoriesUseCase";
import { PublishProductUseCase } from "@/application/use-cases/PublishProductUseCase";
import { ManageCartUseCase } from "@/application/use-cases/ManageCartUseCase";
import { GetConversationsUseCase } from "@/application/use-cases/GetConversationsUseCase";
import { GetChatMessagesUseCase } from "@/application/use-cases/GetChatMessagesUseCase";
import { SendMessageUseCase } from "@/application/use-cases/SendMessageUseCase";

import { ConnectTinderUseCase } from "@/application/use-cases/ConnectTinderUseCase";
import { GetTinderMatchesUseCase } from "@/application/use-cases/GetTinderMatchesUseCase";
import { SendTinderMessageUseCase } from "@/application/use-cases/SendTinderMessageUseCase";

import { SupabaseVaultRepository } from "../repositories/SupabaseVaultRepository";
import { ManageVaultUseCase } from "@/application/use-cases/ManageVaultUseCase";
import { SupabaseRaffleRepository } from "../repositories/SupabaseRaffleRepository";
import { ManageRaffleUseCase } from "@/application/use-cases/ManageRaffleUseCase";
import { SupabaseClothingSaleRepository } from "../repositories/SupabaseClothingSaleRepository";
import { ManageClothingSaleUseCase } from "@/application/use-cases/ManageClothingSaleUseCase";

// Detecção de credenciais do Supabase
const hasSupabaseCredentials = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

// Repositórios: Tinder integrado ao Supabase (tinder_config, tinder_conversations, tinder_messages)
const productRepository = new MockProductRepository();
const cartRepository = new LocalStorageCartRepository();
const chatRepository = new MockChatRepository();
export const vaultRepository = new SupabaseVaultRepository();
export const raffleRepository = new SupabaseRaffleRepository();
export const clothingSaleRepository = new SupabaseClothingSaleRepository();

export const tinderRepository = hasSupabaseCredentials
  ? new SupabaseTinderRepository()
  : new ApiTinderRepository();

// Injeção de dependências nos Casos de Uso (Aplicação)
export const getProductsUseCase = new GetProductsUseCase(productRepository);
export const getCategoriesUseCase = new GetCategoriesUseCase(productRepository);
export const publishProductUseCase = new PublishProductUseCase(productRepository);
export const manageCartUseCase = new ManageCartUseCase(cartRepository);

export const getConversationsUseCase = new GetConversationsUseCase(chatRepository);
export const getChatMessagesUseCase = new GetChatMessagesUseCase(chatRepository);
export const sendMessageUseCase = new SendMessageUseCase(chatRepository);

export const connectTinderUseCase = new ConnectTinderUseCase(tinderRepository);
export const getTinderMatchesUseCase = new GetTinderMatchesUseCase(tinderRepository);
export const sendTinderMessageUseCase = new SendTinderMessageUseCase(tinderRepository);

export const manageVaultUseCase = new ManageVaultUseCase(vaultRepository);
export const manageRaffleUseCase = new ManageRaffleUseCase(raffleRepository);
export const manageClothingSaleUseCase = new ManageClothingSaleUseCase(clothingSaleRepository);

