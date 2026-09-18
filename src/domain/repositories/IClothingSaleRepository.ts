import {
  ClothingSale,
  ClothingSaleAddress,
  ClothingSaleStatus,
} from "../entities/ClothingSale";

export interface CreateClothingSaleInput {
  customerName: string;
  customerCpf: string;
  customerPhone: string; // Número de telefone celular / WhatsApp (obrigatório)
  address: ClothingSaleAddress;
  productDescription: string;
  saleAmount: number;
  shippingPaid: boolean;
  shippingCost?: number;
  inStock: boolean;
  instagramBuyer?: string;
  status?: ClothingSaleStatus;
  notes?: string;
}

export interface IClothingSaleRepository {
  getSales(): Promise<ClothingSale[]>;
  getSaleById(id: string): Promise<ClothingSale | null>;
  createSale(input: CreateClothingSaleInput): Promise<ClothingSale>;
  updateSale(id: string, updates: Partial<ClothingSale>): Promise<ClothingSale>;
  deleteSale(id: string): Promise<void>;
}
