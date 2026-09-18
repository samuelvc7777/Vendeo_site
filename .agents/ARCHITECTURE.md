# Arquitetura do Projeto: Vendeo (Clean Architecture)

## 1. Visão Geral
O **Vendeo** é uma aplicação web desenhada com mentalidade **Mobile-First** e filosofia **App-Like**, estruturada rigorosamente sob os princípios da **Clean Architecture** (Arquitetura Limpa) de Robert C. Martin.

O objetivo é garantir:
- **Independência de Framework:** As regras de negócio não dependem do Next.js ou do React.
- **Testabilidade Total:** Casos de uso e entidades podem ser testados sem navegador ou DOM.
- **Fácil Manutenção e Evolução:** Trocar provedores de dados (Mock para API REST/Supabase) sem alterar uma única linha da interface.
- **Separação Rígida de Responsabilidades:** Respeito absoluto à Regra de Dependência (camadas internas não conhecem camadas externas).

---

## 2. Camadas da Clean Architecture

```text
src/
├── domain/                      # 🧠 CAMADA 1: DOMÍNIO (Zero dependências externas)
│   ├── entities/                # Product, Cart, Category (Entidades com invariantes)
│   ├── repositories/            # Contratos/Interfaces (IProductRepository, ICartRepository)
│   └── value-objects/           # Objetos de valor tipados
│
├── application/                 # ⚙️ CAMADA 2: CASOS DE USO (Regras da Aplicação)
│   └── use-cases/
│       ├── GetProductsUseCase.ts
│       ├── PublishProductUseCase.ts
│       └── ManageCartUseCase.ts
│
├── infrastructure/              # 🔌 CAMADA 3: INFRAESTRUTURA & ADAPTERS
│   ├── repositories/            # Implementações reais (MockProductRepository, ApiProductRepository)
│   └── storage/                 # LocalStorageAdapter / Cache
│
├── presentation/                # 🎨 CAMADA 4: APRESENTAÇÃO (UI Mobile Fluida)
│   ├── components/
│   │   ├── layout/              # MobileContainer, BottomNav, Header
│   │   └── ui/                  # ProductCard, ProductDrawer, CartDrawer, SellModal, CategoryPills
│   └── hooks/                   # useProducts, useCart (ViewModels / Controllers que conectam UseCases à UI)
│
├── lib/                         # Utilitários compartilhados transversais (cn, formatação)
└── app/                         # 🚀 FRAMEWORK: Next.js App Router (Roteamento e Composição)
    ├── layout.tsx
    ├── page.tsx
    └── globals.css
```

---

## 3. Diretrizes de Layout e Ergonomia Móvel
* **Viewport Adaptativo:** `h-dvh` (Dynamic Viewport Height) para evitar saltos com a barra de endereço do navegador.
* **Safe Areas:** Respeito obrigatório a `safe-area-inset-top` e `safe-area-inset-bottom`.
* **Touch Targets:** Mínimo de 44x44px em botões e elementos interativos.
* **Física & Gestos:** Framer Motion para arraste de baixo para cima (*drag to dismiss*) e feedback tátil.
* **Desktop Showcase:** Contêiner simulador de smartphone de última geração no desktop, com chave para expansão de tela.
