export interface ClothingSaleAddress {
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode?: string;
}

export type ClothingSaleStatus =
  | "pending"     // Venda registrada / Aguardando
  | "paid"        // Pagamento confirmado
  | "shipped"     // Pedido postado / enviado
  | "delivered"   // Entregue ao cliente
  | "cancelled";  // Cancelada

export interface ClothingSale {
  id: string;
  customerName: string;
  customerCpf: string;
  customerPhone: string; // Número de telefone obrigatório
  address: ClothingSaleAddress;
  productDescription: string;
  saleAmount: number;
  shippingPaid: boolean;
  shippingCost: number;
  inStock: boolean; // true = em estoque / pronta entrega; false = sob encomenda
  instagramBuyer?: string;
  status: ClothingSaleStatus;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ClothingSaleStats {
  totalSales: number;
  totalRevenue: number;
  inStockCount: number;
  outOfStockCount: number;
  shippingPaidCount: number;
  shippingPendingCount: number;
  totalShippingAmount: number;
}

/**
 * Formata CPF adicionando pontos e traço (000.000.000-00)
 */
export function formatCpf(rawCpf?: string | null): string {
  if (!rawCpf) return "";
  const clean = rawCpf.replace(/\D/g, "");
  if (clean.length <= 3) return clean;
  if (clean.length <= 6) return `${clean.slice(0, 3)}.${clean.slice(3)}`;
  if (clean.length <= 9)
    return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6)}`;
  return `${clean.slice(0, 3)}.${clean.slice(3, 6)}.${clean.slice(6, 9)}-${clean.slice(9, 11)}`;
}

/**
 * Formata endereço completo em linha única legível
 */
export function formatFullAddress(address?: ClothingSaleAddress | null): string {
  if (!address) return "Endereço não informado";
  const parts: string[] = [];
  if (address.street) {
    let main = address.street;
    if (address.number) main += `, nº ${address.number}`;
    if (address.complement) main += ` (${address.complement})`;
    parts.push(main);
  }
  if (address.neighborhood) parts.push(`Bairro ${address.neighborhood}`);
  if (address.city || address.state) {
    const loc = [address.city, address.state].filter(Boolean).join(" - ");
    if (loc) parts.push(loc);
  }
  if (address.zipCode) parts.push(`CEP: ${address.zipCode}`);
  return parts.join(", ");
}

/**
 * Formata número de telefone celular / WhatsApp brasileiro: (00) 00000-0000 ou (00) 0000-0000
 */
export function formatPhone(rawPhone?: string | null): string {
  if (!rawPhone) return "";
  const clean = rawPhone.replace(/\D/g, "");
  if (clean.length === 0) return "";
  if (clean.length <= 2) return `(${clean}`;
  if (clean.length <= 6) return `(${clean.slice(0, 2)}) ${clean.slice(2)}`;
  if (clean.length <= 10)
    return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
  return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7, 11)}`;
}

/**
 * Gera uma etiqueta de envio pronta para WhatsApp ou Correios/Transportadora
 */
export function formatShippingLabel(sale: ClothingSale): string {
  const addressLines = [
    `Destinatário: ${sale.customerName}`,
    sale.customerPhone ? `Telefone / WhatsApp: ${formatPhone(sale.customerPhone)}` : "",
    sale.customerCpf ? `CPF: ${formatCpf(sale.customerCpf)}` : "",
    `Endereço: ${sale.address.street}, ${sale.address.number || "S/N"}${sale.address.complement ? ` - ${sale.address.complement}` : ""}`,
    `Bairro: ${sale.address.neighborhood || "Centro"}`,
    `Cidade/UF: ${sale.address.city} - ${sale.address.state}`,
    sale.address.zipCode ? `CEP: ${sale.address.zipCode}` : "",
    `Item: ${sale.productDescription}`,
    `Valor da Peça: ${sale.saleAmount.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`,
    `Frete: ${sale.shippingPaid ? "PAGO" : "PENDENTE"}${sale.shippingCost > 0 ? ` (${sale.shippingCost.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })})` : ""}`,
    `Estoque: ${sale.inStock ? "Pronta Entrega" : "Sob Encomenda"}`,
  ]
    .filter(Boolean)
    .join("\n");

  return `📦 *DADOS DE ENVIO / VENDA - VENDEO*\n\n${addressLines}`;
}

/**
 * Calcula estatísticas do painel de roupas
 */
export function calculateClothingStats(sales: ClothingSale[]): ClothingSaleStats {
  let totalRevenue = 0;
  let inStockCount = 0;
  let outOfStockCount = 0;
  let shippingPaidCount = 0;
  let shippingPendingCount = 0;
  let totalShippingAmount = 0;

  for (const s of sales) {
    if (s.status !== "cancelled") {
      totalRevenue += s.saleAmount || 0;
      totalShippingAmount += s.shippingCost || 0;
    }

    if (s.inStock) {
      inStockCount++;
    } else {
      outOfStockCount++;
    }

    if (s.shippingPaid) {
      shippingPaidCount++;
    } else {
      shippingPendingCount++;
    }
  }

  return {
    totalSales: sales.length,
    totalRevenue,
    inStockCount,
    outOfStockCount,
    shippingPaidCount,
    shippingPendingCount,
    totalShippingAmount,
  };
}
