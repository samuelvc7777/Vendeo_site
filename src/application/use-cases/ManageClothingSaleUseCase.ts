import {
  ClothingSale,
  ClothingSaleAddress,
  formatCpf,
} from "@/domain/entities/ClothingSale";
import {
  CreateClothingSaleInput,
  IClothingSaleRepository,
} from "@/domain/repositories/IClothingSaleRepository";

export class ManageClothingSaleUseCase {
  constructor(
    private readonly clothingSaleRepository: IClothingSaleRepository
  ) {}

  async getSales(): Promise<ClothingSale[]> {
    return this.clothingSaleRepository.getSales();
  }

  async getSaleById(id: string): Promise<ClothingSale | null> {
    if (!id) return null;
    return this.clothingSaleRepository.getSaleById(id);
  }

  async createSale(input: CreateClothingSaleInput): Promise<ClothingSale> {
    if (!input.customerName || !input.customerName.trim()) {
      throw new Error("O nome do cliente é obrigatório.");
    }

    if (!input.customerPhone || !input.customerPhone.trim()) {
      throw new Error("O número de telefone é obrigatório.");
    }

    const cleanPhone = input.customerPhone.replace(/\D/g, "");
    if (cleanPhone.length < 10) {
      throw new Error("Informe um número de telefone celular / WhatsApp válido com DDD (mínimo 10 dígitos).");
    }

    if (!input.productDescription || !input.productDescription.trim()) {
      throw new Error("A descrição da peça / produto é obrigatória.");
    }

    if (input.saleAmount === undefined || isNaN(input.saleAmount) || input.saleAmount <= 0) {
      throw new Error("Informe um valor válido para a venda.");
    }

    const cleanCpf = (input.customerCpf || "").replace(/\D/g, "");

    const cleanAddress: ClothingSaleAddress = {
      street: (input.address.street || "").trim(),
      number: (input.address.number || "").trim(),
      complement: input.address.complement?.trim() || undefined,
      neighborhood: (input.address.neighborhood || "").trim(),
      city: (input.address.city || "").trim(),
      state: (input.address.state || "").trim().toUpperCase(),
      zipCode: (input.address.zipCode || "").trim(),
    };

    if (!cleanAddress.street || !cleanAddress.city) {
      throw new Error("Endereço incompleto: rua e cidade são obrigatórios.");
    }

    return this.clothingSaleRepository.createSale({
      ...input,
      customerName: input.customerName.trim(),
      customerCpf: cleanCpf,
      customerPhone: cleanPhone,
      address: cleanAddress,
      productDescription: input.productDescription.trim(),
      saleAmount: Number(input.saleAmount),
      shippingPaid: Boolean(input.shippingPaid),
      shippingCost: Number(input.shippingCost || 0),
      inStock: Boolean(input.inStock),
      instagramBuyer: input.instagramBuyer?.trim().replace(/^@/, "") || undefined,
      status: input.status || "paid",
      notes: input.notes?.trim() || undefined,
    });
  }

  async updateSale(
    id: string,
    updates: Partial<ClothingSale>
  ): Promise<ClothingSale> {
    if (!id) throw new Error("ID da venda inválido.");
    return this.clothingSaleRepository.updateSale(id, updates);
  }

  async deleteSale(id: string): Promise<void> {
    if (!id) throw new Error("ID da venda inválido.");
    return this.clothingSaleRepository.deleteSale(id);
  }
}
